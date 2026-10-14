/// <reference types="@cloudflare/workers-types" />

import {
  getArray,
  isRecord,
  notionClient,
  type NotionResponse,
} from '../../scripts/notion/lib/notion-client';
import {
  intakeFieldsFromBody,
  intakeLookupQuery,
  intakePage,
} from '../../scripts/notion/lib/intake-page';
import { googleFormSubmission, processIntake } from '../../platform/intake';
import { bearerToken, errorResponse, jsonHeaders, timingSafeEqual } from './_shared';

interface Env {
  PLATFORM_DB?: D1Database;
  LVBT_MEMBERSHIP_INTAKE_SECRET: string;
  LVBT_NOTION_API_KEY: string;
  LVBT_NOTION_DATA_SOURCE_ID: string;
}
type JsonError =
  'invalid_body' | 'invalid_email' | 'unauthorized' | 'notion_sync_failed' | 'service_unavailable';
const AUTH_CONFIG = ['LVBT_MEMBERSHIP_INTAKE_SECRET'] as const;
const FOLLOW_UP_CONFIG = ['LVBT_NOTION_API_KEY', 'LVBT_NOTION_DATA_SOURCE_ID'] as const;
function missingKeys(env: Env, keys: readonly (keyof Env)[]): string[] {
  return keys.filter((key) => !env[key]);
}
function missingConfig(missing: string[]): Response {
  console.error('/api/membership-intake: required configuration is missing', missing);
  return errorResponse('service_unavailable', 503, { missing });
}
type Upstream = { ok: true; value: NotionResponse } | { ok: false; error: Response };
const notion = notionClient((input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(8000) }),
);
async function followUp(env: Env, pathname: string, body: unknown): Promise<Upstream> {
  try {
    const result = await notion(env.LVBT_NOTION_API_KEY, 'POST', pathname, body);
    if (result.ok) return { ok: true, value: result };
    console.error('/api/membership-intake: Notion follow-up failed', result.status);
  } catch {
    console.error('/api/membership-intake: Notion follow-up unavailable');
  }
  return { ok: false, error: errorResponse<JsonError>('notion_sync_failed', 502) };
}

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const authMissing = missingKeys(env, AUTH_CONFIG);
  if (authMissing.length) return missingConfig(authMissing);
  if (!timingSafeEqual(bearerToken(request), env.LVBT_MEMBERSHIP_INTAKE_SECRET))
    return errorResponse('unauthorized', 401);
  if (!env.PLATFORM_DB) return missingConfig(['PLATFORM_DB']);
  const parsed: unknown = await request.json().catch(() => null);
  if (!isRecord(parsed)) return errorResponse('invalid_body', 400);
  const fields = intakeFieldsFromBody(parsed);
  if (!fields) return errorResponse('invalid_email', 400);
  const outcome = await processIntake(
    { PLATFORM_DB: env.PLATFORM_DB },
    googleFormSubmission(fields),
  );
  if (outcome.kind === 'unavailable') return errorResponse('service_unavailable', 503);
  const missing = missingKeys(env, FOLLOW_UP_CONFIG);
  if (missing.length) return missingConfig(missing);
  const lookup = await followUp(
    env,
    `data_sources/${env.LVBT_NOTION_DATA_SOURCE_ID}/query`,
    intakeLookupQuery(fields),
  );
  if (!lookup.ok) return lookup.error;
  if ((getArray(lookup.value.json, 'results') ?? []).length)
    return Response.json(
      { success: true, notion: 'existing' },
      { status: 200, headers: jsonHeaders },
    );
  const created = await followUp(env, 'pages', intakePage(env.LVBT_NOTION_DATA_SOURCE_ID, fields));
  return created.ok
    ? Response.json({ success: true, notion: 'created' }, { status: 200, headers: jsonHeaders })
    : created.error;
};
