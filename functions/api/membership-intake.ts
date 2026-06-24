/// <reference types="@cloudflare/workers-types" />

import { INTAKE_PROPERTIES as PROP, NOTION_VERSION } from './_intake-schema';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Env {
  LVBT_BEEHIIV_API_KEY: string;
  LVBT_BEEHIIV_PUBLICATION_ID: string;
  LVBT_MEMBERSHIP_INTAKE_SECRET: string;
  LVBT_NOTION_API_KEY: string;
  LVBT_NOTION_DATA_SOURCE_ID: string;
}

interface MembershipIntakeBody {
  email?: string;
  name?: string;
  discord?: string;
  sourceForm?: string;
  submittedAt?: string;
  rawResponseUrl?: string;
  responseId?: string;
  answers?: Record<string, unknown>;
}

type JsonError =
  | 'invalid_body'
  | 'invalid_email'
  | 'unauthorized'
  | 'subscription_failed'
  | 'notion_sync_failed'
  | 'service_unavailable';

const jsonHeaders = {
  'Content-Type': 'application/json',
};

function errorResponse(error: JsonError, status: number): Response {
  return Response.json({ error }, { status, headers: jsonHeaders });
}

function requiredConfig(env: Env): string[] {
  return [
    !env.LVBT_BEEHIIV_API_KEY && 'LVBT_BEEHIIV_API_KEY',
    !env.LVBT_BEEHIIV_PUBLICATION_ID && 'LVBT_BEEHIIV_PUBLICATION_ID',
    !env.LVBT_MEMBERSHIP_INTAKE_SECRET && 'LVBT_MEMBERSHIP_INTAKE_SECRET',
    !env.LVBT_NOTION_API_KEY && 'LVBT_NOTION_API_KEY',
    !env.LVBT_NOTION_DATA_SOURCE_ID && 'LVBT_NOTION_DATA_SOURCE_ID',
  ].filter((value): value is string => Boolean(value));
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? '';
}

// Compare without an early-exit per character so a wrong token can't be
// probed byte-by-byte via response timing.
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

function plainTextProperty(value: string | undefined) {
  return value ? { rich_text: [{ text: { content: value } }] } : { rich_text: [] };
}

function titleProperty(value: string) {
  return { title: [{ text: { content: value } }] };
}

// Notion caps a single rich_text content string at 2000 characters; anything
// longer makes the page-create request fail. One free-text form answer can
// approach that, so every block's content is truncated defensively.
const NOTION_RICH_TEXT_LIMIT = 2000;

function clampToNotionLimit(content: string): string {
  if (content.length <= NOTION_RICH_TEXT_LIMIT) return content;
  return `${content.slice(0, NOTION_RICH_TEXT_LIMIT - 1)}…`;
}

function paragraphBlock(content: string) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: clampToNotionLimit(content) } }],
    },
  };
}

// Render each answer as its own bulleted list item so staff see a real list in
// Notion (rich_text does not parse markdown) and no single block can exceed the
// rich_text limit.
function answerBlocks(answers: Record<string, unknown> | undefined) {
  if (!answers || Object.keys(answers).length === 0) {
    return [paragraphBlock('No additional answers supplied.')];
  }

  return Object.entries(answers).map(([question, answer]) => {
    const value = Array.isArray(answer) ? answer.join(', ') : String(answer ?? '');
    return {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [
          { type: 'text', text: { content: clampToNotionLimit(`${question}: ${value}`) } },
        ],
      },
    };
  });
}

async function subscribeToBeehiiv(env: Env, email: string): Promise<Response> {
  const url = `https://api.beehiiv.com/v2/publications/${env.LVBT_BEEHIIV_PUBLICATION_ID}/subscriptions`;

  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.LVBT_BEEHIIV_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      reactivate_existing: true,
      send_welcome_email: true,
      // Single opt-in: the email comes from Google's verified "Collect email
      // addresses" (the respondent's signed-in account), so it's already
      // confirmed. Create the member as `active` with no extra confirmation
      // click — forcing double opt-in here stranded real signups as `pending`.
      double_opt_override: 'off',
    }),
  });
}

async function syncToNotion(
  env: Env,
  body: MembershipIntakeBody,
  email: string,
): Promise<Response> {
  const displayName = body.name?.trim() || email;
  const submittedAt = body.submittedAt?.trim();
  const rawResponse = body.rawResponseUrl?.trim();
  const source = body.sourceForm?.trim() || 'Google Forms membership intake';
  const responseId = body.responseId?.trim();

  return fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.LVBT_NOTION_API_KEY}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify({
      parent: { data_source_id: env.LVBT_NOTION_DATA_SOURCE_ID },
      properties: {
        [PROP.name.label]: titleProperty(displayName),
        [PROP.email.label]: { email },
        [PROP.discord.label]: plainTextProperty(body.discord?.trim()),
        [PROP.source.label]: plainTextProperty(source),
        [PROP.submittedAt.label]: submittedAt ? { date: { start: submittedAt } } : { date: null },
        [PROP.rawResponse.label]: rawResponse ? { url: rawResponse } : { url: null },
        [PROP.responseId.label]: plainTextProperty(responseId),
      },
      children: answerBlocks(body.answers),
    }),
  });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const missing = requiredConfig(context.env);
  if (missing.length > 0) {
    console.error(
      `/api/membership-intake: missing required Pages secret(s): ${missing.join(', ')}`,
    );
    return errorResponse('service_unavailable', 503);
  }

  if (!timingSafeEqual(bearerToken(context.request), context.env.LVBT_MEMBERSHIP_INTAKE_SECRET)) {
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

  const body: MembershipIntakeBody = parsed;
  const email = (body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return errorResponse('invalid_email', 400);
  }

  const beehiivRes = await subscribeToBeehiiv(context.env, email);
  if (!beehiivRes.ok) {
    console.error('Beehiiv API error', beehiivRes.status, await beehiivRes.text());
    return errorResponse('subscription_failed', 502);
  }
  await beehiivRes.body?.cancel();

  const notionRes = await syncToNotion(context.env, body, email);
  if (!notionRes.ok) {
    console.error('Notion API error', notionRes.status, await notionRes.text());
    return errorResponse('notion_sync_failed', 502);
  }
  await notionRes.body?.cancel();

  return Response.json({ success: true }, { status: 200, headers: jsonHeaders });
};
