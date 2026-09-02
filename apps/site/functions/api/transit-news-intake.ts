/// <reference types="@cloudflare/workers-types" />

// Enriches a transit-news submission after someone fills out the Notion form.
//
// Flow:  Notion form view → new database row (URL only) → Notion database
//        automation fires a "Send webhook" action at this endpoint → we fetch
//        the article, extract headline/date/publication/topics/location + body,
//        and write them back onto the same page.
//
// The Notion automation MUST trigger on "page added" only. This function edits
// page properties; an "any edit" trigger would re-fire on our own write.
//
// Auth: the automation adds a custom header `Authorization: Bearer <secret>`.
// Set LVBT_TRANSIT_NEWS_INTAKE_SECRET to the same value in Cloudflare Pages.
//
// The webhook payload shape is configurable/undocumented (Notion suggests
// webhook.site to inspect it), so we depend only on the page ID and then read
// the authoritative URL via the API.

import { NOTION_VERSION } from './_intake-schema';
import { fetchArticle } from '../../../../scripts/notion/lib/article-extract';
import {
  inferLocation,
  inferPublication,
  inferTopics,
} from '../../../../scripts/notion/lib/transit-topics';
import { makeParagraphBlocks } from '../../../../scripts/notion/lib/notion-blocks';

const NOTION_API = 'https://api.notion.com/v1';

interface Env {
  LVBT_NOTION_API_KEY: string;
  LVBT_TRANSIT_NEWS_INTAKE_SECRET: string;
}

type JsonError = 'invalid_body' | 'unauthorized' | 'no_page_id' | 'no_url' | 'service_unavailable';

const REQUIRED_SECRETS = ['LVBT_NOTION_API_KEY', 'LVBT_TRANSIT_NEWS_INTAKE_SECRET'] as const;

const jsonHeaders = { 'Content-Type': 'application/json' };

function errorResponse(error: JsonError, status: number): Response {
  return Response.json({ error }, { status, headers: jsonHeaders });
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? '';
}

// Compare without an early-exit per character so a wrong token can't be probed
// byte-by-byte via response timing.
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const NOTION_ID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

// The webhook body shape isn't guaranteed, so probe the paths Notion has used
// for the triggering page, then fall back to a shallow scan for an id-shaped
// string. The full payload is logged once so the exact path can be confirmed in
// `wrangler pages deployment tail` if a future Notion change moves it.
function findPageId(body: Record<string, unknown>): string | undefined {
  const data = isRecord(body['data']) ? body['data'] : undefined;
  const page = isRecord(body['page']) ? body['page'] : undefined;
  const dataPage = data && isRecord(data['page']) ? data['page'] : undefined;

  const candidates = [
    data?.['id'],
    body['id'],
    page?.['id'],
    dataPage?.['id'],
    isRecord(body['entity']) ? body['entity']['id'] : undefined,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && NOTION_ID_RE.test(candidate)) return candidate;
  }
  return undefined;
}

function notionHeaders(env: Env): HeadersInit {
  return {
    Authorization: `Bearer ${env.LVBT_NOTION_API_KEY}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION,
  };
}

// Read the first url-typed property (preferring one literally named "URL"), so
// the function works even if the column is renamed.
function urlFromPage(page: unknown): string | undefined {
  if (!isRecord(page)) return undefined;
  const props = page['properties'];
  if (!isRecord(props)) return undefined;

  const named = props['URL'];
  if (isRecord(named) && named['type'] === 'url' && typeof named['url'] === 'string') {
    return named['url'];
  }
  for (const value of Object.values(props)) {
    if (isRecord(value) && value['type'] === 'url' && typeof value['url'] === 'string') {
      return value['url'];
    }
  }
  return undefined;
}

// Whether the title property already has submitter-written text we shouldn't
// overwrite with the scraped og:title.
function titleIsEmpty(page: unknown): boolean {
  if (!isRecord(page)) return true;
  const props = page['properties'];
  if (!isRecord(props)) return true;
  for (const value of Object.values(props)) {
    if (isRecord(value) && value['type'] === 'title' && Array.isArray(value['title'])) {
      const text = value['title']
        .map((t) => (isRecord(t) && typeof t['plain_text'] === 'string' ? t['plain_text'] : ''))
        .join('')
        .trim();
      return text.length === 0;
    }
  }
  return true;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const missing = REQUIRED_SECRETS.filter((key) => !context.env[key]);
  if (missing.length > 0) {
    console.error(
      `/api/transit-news-intake: missing required Pages secret(s): ${missing.join(', ')}`,
    );
    return errorResponse('service_unavailable', 503);
  }

  if (!timingSafeEqual(bearerToken(context.request), context.env.LVBT_TRANSIT_NEWS_INTAKE_SECRET)) {
    return errorResponse('unauthorized', 401);
  }

  let parsed: unknown;
  try {
    parsed = await context.request.json();
  } catch {
    return errorResponse('invalid_body', 400);
  }
  if (!isRecord(parsed)) {
    return errorResponse('invalid_body', 400);
  }

  const pageId = findPageId(parsed);
  if (!pageId) {
    // Surface the real shape so the id path can be confirmed and pinned.
    console.error('/api/transit-news-intake: no page id in payload', JSON.stringify(parsed));
    return errorResponse('no_page_id', 400);
  }

  // Read the authoritative page — don't trust the webhook's property serialization.
  const pageRes = await fetch(`${NOTION_API}/pages/${pageId}`, {
    headers: notionHeaders(context.env),
  });
  if (!pageRes.ok) {
    console.error('Notion retrieve-page error', pageRes.status, await pageRes.text());
    return errorResponse('service_unavailable', 502);
  }
  const page = await pageRes.json();

  const url = urlFromPage(page);
  if (!url) {
    return errorResponse('no_url', 400);
  }

  // Fetch + parse the article. A scrape failure is effectively permanent, so we
  // return 200 (no retry storm) and leave the row as the submitter typed it.
  let article;
  try {
    article = await fetchArticle(url);
  } catch (err) {
    console.warn(`/api/transit-news-intake: scrape failed for ${url}: ${String(err)}`);
    return Response.json(
      { enriched: false, reason: 'scrape_failed' },
      { status: 200, headers: jsonHeaders },
    );
  }

  const properties: Record<string, unknown> = {};
  if (titleIsEmpty(page) && article.headline) {
    properties['Headline'] = { title: [{ type: 'text', text: { content: article.headline } }] };
  }
  if (article.publishedIso) properties['Published'] = { date: { start: article.publishedIso } };
  const publication = inferPublication(url);
  if (publication) properties['Publication'] = { select: { name: publication } };
  const topics = inferTopics(article.headline, article.bodyText);
  if (topics.length > 0) properties['Topics'] = { multi_select: topics.map((name) => ({ name })) };
  const location = inferLocation(article.headline, article.bodyText);
  if (location) properties['Location'] = { select: { name: location } };

  if (Object.keys(properties).length > 0) {
    const patchRes = await fetch(`${NOTION_API}/pages/${pageId}`, {
      method: 'PATCH',
      headers: notionHeaders(context.env),
      body: JSON.stringify({ properties }),
    });
    if (!patchRes.ok) {
      console.error('Notion update-page error', patchRes.status, await patchRes.text());
      return errorResponse('service_unavailable', 502);
    }
    await patchRes.body?.cancel();
  }

  if (article.bodyText) {
    const blocks = makeParagraphBlocks(article.bodyText);
    for (let i = 0; i < blocks.length; i += 100) {
      const appendRes = await fetch(`${NOTION_API}/blocks/${pageId}/children`, {
        method: 'PATCH',
        headers: notionHeaders(context.env),
        body: JSON.stringify({ children: blocks.slice(i, i + 100) }),
      });
      if (!appendRes.ok) {
        console.error('Notion append-blocks error', appendRes.status, await appendRes.text());
        break;
      }
      await appendRes.body?.cancel();
    }
  }

  return Response.json({ enriched: true, url }, { status: 200, headers: jsonHeaders });
};
