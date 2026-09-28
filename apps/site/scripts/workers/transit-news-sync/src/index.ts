/**
 * Transit News Sync — Notion Worker
 *
 * Two capabilities:
 *   Sync  — runs weekly, pulls Google News RSS for "Las Vegas transit",
 *            inserts new articles into the Transit News Notion database.
 *   Tool  — callable by Notion AI ("@Agent add this article: [url]"),
 *            accepts an array of URLs and runs the same intake pipeline.
 *
 * Article extraction and metadata inference come from the shared libs under
 * scripts/notion/lib/ — the same source the pnpm script and the Cloudflare
 * function use, so the topic/publication maps never drift between them. The
 * bundler inlines them at `ntn workers deploy` time.
 *
 * Deploy:  ntn workers deploy
 * Test:    ntn workers run transit-news-sync --capability syncs --id weekly-rss
 */

import { fetchArticle } from '../../../notion/lib/article-extract.js';
import {
  inferPublication,
  inferTopics,
  inferLocation,
} from '../../../notion/lib/transit-topics.js';
import { makeParagraphBlocks } from '../../../notion/lib/notion-blocks.js';

// ---------------------------------------------------------------------------
// Types (from Notion Workers runtime — adjust if ntn provides @types package)
// ---------------------------------------------------------------------------

interface SyncContext {
  notion: NotionClient;
  log: (msg: string) => void;
  env: WorkerEnv;
}

interface ToolContext {
  notion: NotionClient;
  log: (msg: string) => void;
  input: unknown;
  env: WorkerEnv;
}

interface WorkerEnv {
  /** Transit News database ID — set as a Worker secret/binding. */
  LVBT_TRANSIT_NEWS_DB_ID?: string;
  /** Optional Google News search query; defaults to "Las Vegas transit". */
  LVBT_TRANSIT_NEWS_RSS_QUERY?: string;
}

interface NotionClient {
  databases: {
    query: (params: {
      database_id: string;
      filter?: unknown;
      page_size?: number;
    }) => Promise<{ results: unknown[] }>;
  };
  pages: {
    create: (params: unknown) => Promise<{ id: string }>;
  };
  blocks: {
    children: {
      append: (params: { block_id: string; children: unknown[] }) => Promise<unknown>;
    };
  };
}

// ---------------------------------------------------------------------------
// Config — all runtime config comes from Worker secrets/bindings (ctx.env).
//
// Parked until Notion Workers leaves private beta. When wiring it up, set
// LVBT_TRANSIT_NEWS_DB_ID as a Worker secret and switch the injected client to
// the data-source model, mirroring the pnpm script.
// ---------------------------------------------------------------------------

const DEFAULT_RSS_QUERY = 'Las Vegas transit';

function rssUrl(query: string): string {
  const params = new URLSearchParams({ q: query, hl: 'en-US', gl: 'US', ceid: 'US:en' });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

function requireDbId(env: WorkerEnv): string {
  const id = env.LVBT_TRANSIT_NEWS_DB_ID?.trim();
  if (!id) throw new Error('LVBT_TRANSIT_NEWS_DB_ID is not set as a Worker secret');
  return id;
}

// ---------------------------------------------------------------------------
// Capability handlers (exported — Notion Workers runtime calls these)
// ---------------------------------------------------------------------------

export async function onSync(ctx: SyncContext): Promise<void> {
  const dbId = requireDbId(ctx.env);
  const query = ctx.env.LVBT_TRANSIT_NEWS_RSS_QUERY?.trim() || DEFAULT_RSS_QUERY;
  ctx.log(`Fetching Google News RSS for "${query}"…`);
  const urls = await fetchRssUrls(rssUrl(query));
  ctx.log(`Found ${urls.length} article(s) in feed.`);
  await ingestUrls(ctx.notion, ctx.log, dbId, urls);
}

export async function onTool(
  ctx: ToolContext,
): Promise<{ added: number; skipped: number; errors: number }> {
  const dbId = requireDbId(ctx.env);
  const input = ctx.input as { urls?: unknown };
  if (!Array.isArray(input?.urls) || input.urls.length === 0) {
    throw new Error('urls must be a non-empty array of strings');
  }
  const urls: string[] = input.urls.filter((u): u is string => typeof u === 'string');
  return ingestUrls(ctx.notion, ctx.log, dbId, urls);
}

// ---------------------------------------------------------------------------
// Core ingestion pipeline (shared between Sync and Tool)
// ---------------------------------------------------------------------------

async function ingestUrls(
  notion: NotionClient,
  log: (msg: string) => void,
  dbId: string,
  urls: string[],
): Promise<{ added: number; skipped: number; errors: number }> {
  let added = 0;
  let skipped = 0;
  let errors = 0;

  for (const url of urls) {
    log(`Processing ${url}`);
    try {
      const dup = await isDuplicate(notion, dbId, url);
      if (dup) {
        log(`  → already in database, skipping`);
        skipped++;
        continue;
      }

      const article = await fetchArticle(url);
      const publication = inferPublication(url);
      const topics = inferTopics(article.headline, article.bodyText);
      const location = inferLocation(article.headline, article.bodyText);

      const properties: Record<string, unknown> = {
        Headline: { title: [{ type: 'text', text: { content: article.headline } }] },
        URL: { url: article.url },
      };
      if (article.publishedIso) properties['Published'] = { date: { start: article.publishedIso } };
      if (publication) properties['Publication'] = { select: { name: publication } };
      if (topics.length > 0)
        properties['Topics'] = { multi_select: topics.map((t) => ({ name: t })) };
      if (location) properties['Location'] = { select: { name: location } };

      const page = await notion.pages.create({ parent: { database_id: dbId }, properties });
      log(`  → created page ${page.id}`);

      if (article.bodyText) {
        const blocks = makeParagraphBlocks(article.bodyText);
        for (let i = 0; i < blocks.length; i += 100) {
          await notion.blocks.children.append({
            block_id: page.id,
            children: blocks.slice(i, i + 100),
          });
        }
      }

      added++;
    } catch (err) {
      log(`  ✖ error: ${String(err)}`);
      errors++;
    }
  }

  log(`Done. added=${added} skipped=${skipped} errors=${errors}`);
  return { added, skipped, errors };
}

// ---------------------------------------------------------------------------
// RSS parsing (no external dependency — regex-based Atom/RSS 2.0 parser)
// ---------------------------------------------------------------------------

async function fetchRssUrls(feedUrl: string): Promise<string[]> {
  const res = await fetch(feedUrl, {
    headers: { 'User-Agent': 'LVBTBot/1.0 (+https://lasvegasfortransit.org)' },
  });
  if (!res.ok) throw new Error(`RSS fetch failed: HTTP ${res.status}`);
  const xml = await res.text();

  // Google News RSS wraps the actual article URL in <link> after a redirect.
  // We extract <link> elements (RSS 2.0) or <url> elements (Atom).
  const links: string[] = [];
  const linkRe = /<link[^>]*>([^<]+)<\/link>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(xml)) !== null) {
    const href = (m[1] ?? '').trim();
    if (href.startsWith('http') && !href.includes('news.google.com')) links.push(href);
  }

  // Deduplicate
  return [...new Set(links)].slice(0, 50);
}

// ---------------------------------------------------------------------------
// Notion helpers
// ---------------------------------------------------------------------------

async function isDuplicate(notion: NotionClient, dbId: string, url: string): Promise<boolean> {
  const res = await notion.databases.query({
    database_id: dbId,
    filter: { property: 'URL', url: { equals: url } },
    page_size: 1,
  });
  return res.results.length > 0;
}
