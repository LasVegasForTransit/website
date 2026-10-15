import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTION_VERSION } from '../../functions/api/_notion';
import { rosterObject } from '../../platform/roster-evidence';

interface SourceConfig {
  beehiivKey: string;
  publicationId: string;
  notionKey: string;
  dataSourceId: string;
}
interface NotionSourceRow {
  page: Record<string, unknown>;
  blocks: unknown[];
}
export interface RosterSourceSnapshot {
  observedAt: string;
  beehiiv: unknown[];
  notion: NotionSourceRow[];
}
async function json(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('Source export connection failed');
  }
  if (!response.ok)
    throw new Error(
      `Source export failed (HTTP ${response.status}); no source records were changed`,
    );
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Source export returned an invalid page');
  return value as Record<string, unknown>;
}
async function beehiivRows(config: SourceConfig, fetcher: typeof fetch): Promise<unknown[]> {
  const rows: unknown[] = [],
    ids = new Set<string>(),
    cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const url = `https://api.beehiiv.com/v2/publications/${config.publicationId}/subscriptions?limit=100&status=all&expand%5B%5D=custom_fields${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const body = await json(fetcher, url, {
      headers: { Authorization: `Bearer ${config.beehiivKey}` },
    });
    if (!Array.isArray(body.data) || typeof body.has_more !== 'boolean')
      throw new Error('Beehiiv export pagination is incomplete');
    for (const row of body.data) {
      const id = rosterObject(row).id;
      if (typeof id !== 'string' || ids.has(id))
        throw new Error('Beehiiv export repeated or omitted an account identifier');
      ids.add(id);
      rows.push(row);
    }
    if (!body.has_more) {
      verifyTotal(body, rows.length);
      return rows;
    }
    cursor = nextCursor(body, cursors);
  } while (cursor);
  return rows;
}
function verifyTotal(body: Record<string, unknown>, length: number): void {
  if (typeof body.total_results === 'number' && length !== body.total_results)
    throw new Error('Beehiiv export count changed; repeat the export');
}
function nextCursor(body: Record<string, unknown>, seen: Set<string>): string {
  const cursor = body.next_cursor;
  if (typeof cursor !== 'string' || !cursor || seen.has(cursor) || seen.size >= 10_000)
    throw new Error('Source export cursor is invalid');
  seen.add(cursor);
  return cursor;
}
function notionHeaders(config: SourceConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.notionKey}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}
async function notionPages(
  config: SourceConfig,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [],
    seen = new Set<string>();
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const body = await json(
      fetcher,
      `https://api.notion.com/v1/data_sources/${config.dataSourceId}/query`,
      {
        method: 'POST',
        headers: notionHeaders(config),
        body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
      },
    );
    if (!Array.isArray(body.results) || typeof body.has_more !== 'boolean')
      throw new Error('Notion export pagination is incomplete');
    for (const value of body.results) {
      const row = rosterObject(value),
        id = row.id;
      if (typeof id !== 'string' || seen.has(id))
        throw new Error('Notion export repeated or omitted a page identifier');
      seen.add(id);
      rows.push(row);
    }
    if (!body.has_more) return rows;
    cursor = nextCursor(body, cursors);
  } while (cursor);
  return rows;
}
async function notionBlocks(
  config: SourceConfig,
  fetcher: typeof fetch,
  id: string,
  seen: Set<string>,
): Promise<unknown[]> {
  if (seen.has(id) || seen.size > 100_000)
    throw new Error('Notion block export repeated or exceeded its safety limit');
  seen.add(id);
  const blocks: unknown[] = [];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const body = await json(
      fetcher,
      `https://api.notion.com/v1/blocks/${encodeURIComponent(id)}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`,
      { headers: notionHeaders(config) },
    );
    if (!Array.isArray(body.results) || typeof body.has_more !== 'boolean')
      throw new Error('Notion answer export pagination is incomplete');
    for (const value of body.results) {
      blocks.push(await exportBlock(config, fetcher, value, seen));
    }
    if (!body.has_more) return blocks;
    cursor = nextCursor(body, cursors);
  } while (cursor);
  return blocks;
}
async function exportBlock(
  config: SourceConfig,
  fetcher: typeof fetch,
  value: unknown,
  seen: Set<string>,
): Promise<Record<string, unknown>> {
  const block = rosterObject(value);
  if (typeof block.id !== 'string') throw new Error('Notion answer block has no identifier');
  if (block.has_children === true)
    block.exported_children = await notionBlocks(config, fetcher, block.id, seen);
  return block;
}
/** Provider reads only. Notion's POST query does not change the source. */
export async function exportRosterSources(
  config: SourceConfig,
  fetcher: typeof fetch = fetch,
): Promise<RosterSourceSnapshot> {
  if (
    !/^pub_[A-Za-z0-9_-]+$/.test(config.publicationId) ||
    !config.beehiivKey.trim() ||
    !config.notionKey.trim() ||
    !/^[a-f0-9-]{32,36}$/i.test(config.dataSourceId)
  )
    throw new Error('Source export configuration is incomplete');
  const observedAt = new Date().toISOString(),
    beehiiv = await beehiivRows(config, fetcher),
    pages = await notionPages(config, fetcher),
    notion: NotionSourceRow[] = [];
  for (const page of pages)
    notion.push({ page, blocks: await notionBlocks(config, fetcher, String(page.id), new Set()) });
  return { observedAt, beehiiv, notion };
}
async function main(args: string[]): Promise<number> {
  if (args.length !== 2 || args[0] !== '--directory' || !args[1]) {
    process.stderr.write('Usage: pnpm roster:export --directory <private-folder>\n');
    return 2;
  }
  try {
    const snapshot = await exportRosterSources({
      beehiivKey: process.env.LVBT_BEEHIIV_API_KEY ?? '',
      publicationId: process.env.LVBT_BEEHIIV_PUBLICATION_ID ?? '',
      notionKey: process.env.LVBT_NOTION_API_KEY ?? '',
      dataSourceId: process.env.LVBT_NOTION_DATA_SOURCE_ID ?? '',
    });
    await mkdir(args[1], { recursive: true, mode: 0o700 });
    await chmod(args[1], 0o700);
    await writeFile(
      resolve(args[1], 'sources-original.json'),
      JSON.stringify(snapshot, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    process.stdout.write(
      `Beehiiv subscriptions read: ${snapshot.beehiiv.length}\nNotion intake rows read: ${snapshot.notion.length}\n`,
    );
    return 0;
  } catch (error) {
    const message =
      error instanceof Error && /^(Source export|Beehiiv export|Notion)/.test(error.message)
        ? error.message
        : 'Source export failed; verify the existing API configuration';
    process.stderr.write(message + '\n');
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await main(process.argv.slice(2));
