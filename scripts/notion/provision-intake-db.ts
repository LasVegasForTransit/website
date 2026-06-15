/**
 * Provision the membership-intake Notion database.
 *
 * Creates the data source with the exact schema the Pages Function writes to
 * (functions/api/_intake-schema.ts), then writes its data source ID into
 * .env.local. Idempotent: an existing "Membership intake" data source is
 * reused instead of duplicated.
 *
 * Prerequisites (see docs/reference/membership-intake.md — these are the parts
 * the Notion API cannot do for you):
 *   - LVBT_NOTION_API_KEY: an internal integration token, in .env.local
 *   - LVBT_NOTION_PARENT_PAGE_ID: a page shared with that integration
 *
 * Run with: pnpm setup:notion
 */
import path from 'node:path';
import process from 'node:process';

import { parseEnvFile, mergeEnvFile } from '../bootstrap/lib/env-file.js';
import {
  INTAKE_PROPERTIES,
  NOTION_VERSION,
  intakeDataSourceProperties,
} from '../../functions/api/_intake-schema.js';

const NOTION_API = 'https://api.notion.com/v1';
const DB_TITLE = 'Membership intake';

interface NotionResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

async function notion(
  token: string,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<NotionResponse> {
  const res = await fetch(`${NOTION_API}/${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

// Notion responses come back as `unknown`; these read one field safely so the
// callers below stay free of repeated object/null/typeof narrowing.
function getString(obj: unknown, key: string): string | undefined {
  if (typeof obj === 'object' && obj !== null) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function getArray(obj: unknown, key: string): unknown[] | undefined {
  if (typeof obj === 'object' && obj !== null) {
    const value = (obj as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

function notionErrorMessage(json: unknown): string {
  return getString(json, 'message') ?? 'unknown Notion API error';
}

/** Pull a plain-text title off a data source (or database) search result. */
function resultTitle(result: unknown): string {
  const title = getArray(result, 'title');
  return title ? title.map((rt) => getString(rt, 'plain_text') ?? '').join('') : '';
}

/** data_sources[0].id from a Create-a-database response. */
function firstDataSourceId(created: unknown): string | undefined {
  const sources = getArray(created, 'data_sources');
  return sources && sources.length > 0 ? getString(sources[0], 'id') : undefined;
}

function die(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const envPath = path.join(projectRoot, '.env.local');
  const env = parseEnvFile(envPath);

  const token = (env.get('LVBT_NOTION_API_KEY') ?? process.env.LVBT_NOTION_API_KEY ?? '').trim();
  if (!token) {
    die(
      'LVBT_NOTION_API_KEY is not set in .env.local.\n' +
        '  Create an internal integration at https://www.notion.so/my-integrations,\n' +
        '  copy its token, then run `pnpm bootstrap --phase env` (or set it by hand).',
    );
  }

  const parentPageId = (
    env.get('LVBT_NOTION_PARENT_PAGE_ID') ??
    process.env.LVBT_NOTION_PARENT_PAGE_ID ??
    ''
  ).trim();
  if (!parentPageId) {
    die(
      'LVBT_NOTION_PARENT_PAGE_ID is not set in .env.local.\n' +
        '  Create a page in Notion, share it with your integration (••• → Connections),\n' +
        '  copy the 32-character ID from its URL, and add it to .env.local as\n' +
        '  LVBT_NOTION_PARENT_PAGE_ID. See docs/reference/membership-intake.md.',
    );
  }

  // 1. Verify the token.
  const me = await notion(token, 'GET', 'users/me');
  if (!me.ok) {
    die(`Notion rejected LVBT_NOTION_API_KEY (HTTP ${me.status}): ${notionErrorMessage(me.json)}`);
  }

  // 2. Verify the integration can see the parent page.
  const page = await notion(token, 'GET', `pages/${parentPageId}`);
  if (!page.ok) {
    die(
      `The integration cannot access the parent page (HTTP ${page.status}): ${notionErrorMessage(page.json)}\n` +
        '  Open the page in Notion → ••• → Connections → add your integration, then re-run.',
    );
  }

  // 3. Reuse an existing intake data source if one is already there.
  const search = await notion(token, 'POST', 'search', {
    query: DB_TITLE,
    filter: { value: 'data_source', property: 'object' },
  });
  const results = search.ok ? getArray(search.json, 'results') : undefined;
  const existing = results?.find((r) => resultTitle(r) === DB_TITLE);
  const existingId = existing ? getString(existing, 'id') : undefined;
  if (existingId) {
    console.log(`• Found an existing "${DB_TITLE}" data source — reusing it.`);
    await writeDataSourceId(envPath, existingId);
    return;
  }

  // 4. Create the database, its first data source, and the schema in one call.
  const created = await notion(token, 'POST', 'databases', {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: DB_TITLE } }],
    initial_data_source: { properties: intakeDataSourceProperties() },
  });
  if (!created.ok) {
    die(
      `Could not create the database (HTTP ${created.status}): ${notionErrorMessage(created.json)}`,
    );
  }

  const dataSourceId = firstDataSourceId(created.json);
  if (!dataSourceId) {
    die(
      'Notion created the database but returned no data source ID. Inspect the response and set LVBT_NOTION_DATA_SOURCE_ID by hand.',
    );
  }

  const columns = Object.values(INTAKE_PROPERTIES)
    .map((p) => p.label)
    .join(', ');
  console.log(`✓ Created "${DB_TITLE}" with columns: ${columns}`);
  await writeDataSourceId(envPath, dataSourceId);
}

async function writeDataSourceId(envPath: string, id: string): Promise<void> {
  mergeEnvFile(envPath, new Map([['LVBT_NOTION_DATA_SOURCE_ID', id]]));
  console.log(`✓ Wrote LVBT_NOTION_DATA_SOURCE_ID=${id} to .env.local`);
  console.log(
    '\nNext: push it to production with `pnpm bootstrap --phase deploy`\n' +
      '(or set LVBT_NOTION_DATA_SOURCE_ID in the Cloudflare Pages dashboard) and redeploy.',
  );
}

await main();
