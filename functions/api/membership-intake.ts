/// <reference types="@cloudflare/workers-types" />

import {
  getArray,
  isRecord,
  notionErrorMessage,
  notionFetch,
  type NotionResponse,
} from '../../scripts/notion/lib/notion-client';
import {
  intakeFieldsFromBody,
  intakeLookupQuery,
  intakePage,
} from '../../scripts/notion/lib/intake-page';
import { bearerToken, errorResponse, jsonHeaders, timingSafeEqual } from './_shared';

interface Env {
  LVBT_BEEHIIV_API_KEY: string;
  LVBT_BEEHIIV_PUBLICATION_ID: string;
  LVBT_MEMBERSHIP_INTAKE_SECRET: string;
  LVBT_NOTION_API_KEY: string;
  LVBT_NOTION_DATA_SOURCE_ID: string;
}

type JsonError =
  | 'invalid_body'
  | 'invalid_email'
  | 'unauthorized'
  | 'subscription_failed'
  | 'notion_sync_failed'
  | 'service_unavailable';

// Secrets needed to authenticate a caller, then the rest needed to fulfil the
// request. Only an authenticated caller learns which of the latter are unset.
const AUTH_CONFIG = ['LVBT_MEMBERSHIP_INTAKE_SECRET'] as const;
const FULFIL_CONFIG = [
  'LVBT_BEEHIIV_API_KEY',
  'LVBT_BEEHIIV_PUBLICATION_ID',
  'LVBT_NOTION_API_KEY',
  'LVBT_NOTION_DATA_SOURCE_ID',
] as const;

function missingKeys(env: Env, keys: readonly (keyof Env)[]): string[] {
  return keys.filter((key) => !env[key]);
}

function missingConfig(missing: string[]): Response {
  console.error(`/api/membership-intake: missing required Pages secret(s): ${missing.join(', ')}`);
  return errorResponse('service_unavailable', 503, { missing });
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
      // Adding a member sends nothing: no welcome email, and no confirmation
      // step because Google already verified the address ("Collect email
      // addresses"). Forcing double opt-in here stranded signups as `pending`.
      send_welcome_email: false,
      double_opt_override: 'off',
    }),
  });
}

type Upstream<T> = { ok: true; value: T } | { ok: false; error: Response };

// Run one upstream call and map both a thrown request and a non-2xx reply to
// the given 502 code, logging enough to tell the failures apart.
async function callUpstream<T extends { ok: boolean; status: number }>(
  label: string,
  code: JsonError,
  send: () => Promise<T>,
  detail: (res: T) => Promise<string>,
): Promise<Upstream<T>> {
  let res: T;
  try {
    res = await send();
  } catch (err) {
    console.error(`${label} request failed`, err);
    return { ok: false, error: errorResponse<JsonError>(code, 502) };
  }
  if (!res.ok) {
    console.error(`${label} API error`, res.status, await detail(res));
    return { ok: false, error: errorResponse<JsonError>(code, 502) };
  }
  return { ok: true, value: res };
}

const notionDetail = async (res: NotionResponse) => notionErrorMessage(res.json);

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authMissing = missingKeys(env, AUTH_CONFIG);
  if (authMissing.length > 0) return missingConfig(authMissing);

  if (!timingSafeEqual(bearerToken(request), env.LVBT_MEMBERSHIP_INTAKE_SECRET)) {
    return errorResponse('unauthorized', 401);
  }

  const missing = missingKeys(env, FULFIL_CONFIG);
  if (missing.length > 0) return missingConfig(missing);

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return errorResponse('invalid_body', 400);
  }
  if (!isRecord(parsed)) return errorResponse('invalid_body', 400);

  const fields = intakeFieldsFromBody(parsed);
  if (!fields) return errorResponse('invalid_email', 400);

  const notion = (pathname: string, body: unknown) =>
    notionFetch(env.LVBT_NOTION_API_KEY, 'POST', pathname, body);

  // The subscribe and the duplicate lookup don't depend on each other; only
  // the page create waits on the lookup.
  const [beehiiv, lookup] = await Promise.all([
    callUpstream(
      'Beehiiv',
      'subscription_failed',
      () => subscribeToBeehiiv(env, fields.email),
      (res) => res.text().catch(() => '<unreadable body>'),
    ),
    callUpstream(
      'Notion lookup',
      'notion_sync_failed',
      () =>
        notion(`data_sources/${env.LVBT_NOTION_DATA_SOURCE_ID}/query`, intakeLookupQuery(fields)),
      notionDetail,
    ),
  ]);
  if (!beehiiv.ok) return beehiiv.error;
  // Workers holds the connection until the body is consumed or cancelled.
  await beehiiv.value.body?.cancel().catch(() => undefined);
  if (!lookup.ok) return lookup.error;

  if ((getArray(lookup.value.json, 'results') ?? []).length > 0) {
    return Response.json(
      { success: true, notion: 'existing' },
      { status: 200, headers: jsonHeaders },
    );
  }

  const create = await callUpstream(
    'Notion page create',
    'notion_sync_failed',
    () => notion('pages', intakePage(env.LVBT_NOTION_DATA_SOURCE_ID, fields)),
    notionDetail,
  );
  if (!create.ok) return create.error;

  return Response.json({ success: true, notion: 'created' }, { status: 200, headers: jsonHeaders });
};
