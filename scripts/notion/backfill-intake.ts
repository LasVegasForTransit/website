/**
 * Create Notion intake pages for submissions that never reached the endpoint,
 * without touching Beehiiv (so nobody is emailed).
 *
 * Input: a JSON array of endpoint-shaped bodies — the same fields Apps Script
 * posts to /api/membership-intake (email, name, discord, sourceForm,
 * submittedAt, rawResponseUrl, responseId, answers). Idempotent: a submission
 * whose Response ID (or, failing that, email) already has a page is skipped.
 *
 * Needs LVBT_NOTION_API_KEY and LVBT_NOTION_DATA_SOURCE_ID in .env.local.
 *
 * Run with: pnpm tsx scripts/notion/backfill-intake.ts <payloads.json>
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';

import { loadEnvLocal } from '../bootstrap/lib/load-env.js';
import { die, requireEnv } from './lib/cli.js';
import { intakeFieldsFromBody, intakeLookupQuery, intakePage } from './lib/intake-page.js';
import { getArray, isRecord, notionErrorMessage, notionFetch } from './lib/notion-client.js';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) die('Usage: pnpm tsx scripts/notion/backfill-intake.ts <payloads.json>');

  loadEnvLocal(process.cwd());
  const token = requireEnv('LVBT_NOTION_API_KEY', 'See docs/reference/membership-intake.md.');
  const dataSourceId = requireEnv('LVBT_NOTION_DATA_SOURCE_ID', 'Run `pnpm setup:notion`.');

  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) die('Input must be a JSON array.');
  const entries = parsed.map((raw, index) => {
    const fields = isRecord(raw) ? intakeFieldsFromBody(raw) : undefined;
    return fields ?? die(`Entry ${index} is not an object with a valid email.`);
  });

  let created = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const fields of entries) {
    const label = `${fields.submittedAt ?? '(no timestamp)'} ${fields.email}`;
    const lookup = await notionFetch(
      token,
      'POST',
      `data_sources/${dataSourceId}/query`,
      intakeLookupQuery(fields),
    );
    if (!lookup.ok) {
      failed.push(`${label} — lookup HTTP ${lookup.status}: ${notionErrorMessage(lookup.json)}`);
      continue;
    }
    if ((getArray(lookup.json, 'results') ?? []).length > 0) {
      skipped += 1;
      console.log(`skip     ${label} (page exists)`);
      continue;
    }
    const create = await notionFetch(token, 'POST', 'pages', intakePage(dataSourceId, fields));
    if (!create.ok) {
      failed.push(`${label} — create HTTP ${create.status}: ${notionErrorMessage(create.json)}`);
      continue;
    }
    created += 1;
    console.log(`created  ${label}`);
  }

  console.log(`\n${created} created, ${skipped} skipped, ${failed.length} failed`);
  for (const line of failed) console.error(`  ✖ ${line}`);
  if (failed.length > 0) process.exit(1);
}

await main();
