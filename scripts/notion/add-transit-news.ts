/**
 * Add one or more transit news articles to the Notion "Transit News" database.
 *
 * Fetches each URL, extracts headline / date / publication / topics / location /
 * body text from HTML meta tags and keyword maps, deduplicates by URL, then
 * inserts new rows via the Notion API (2025-09-03+ data-source model).
 *
 * Prerequisites (all from .env.local — nothing hardcoded):
 *   - LVBT_NOTION_API_KEY: internal integration token
 *   - LVBT_TRANSIT_NEWS_DB_ID: the Transit News database ID (from its Notion URL)
 *   - Integration connected to that database:
 *       Open the DB in Notion → ••• → Connections → add your integration
 *
 * Run with: pnpm add:transit-news <url> [url ...]
 */
import path from 'node:path';
import process from 'node:process';

import { parseEnvFile } from '../bootstrap/lib/env-file.js';
import { fetchArticle } from './lib/article-extract.js';
import { inferPublication, inferTopics, inferLocation } from './lib/transit-topics.js';
import { makeParagraphBlocks } from './lib/notion-blocks.js';
import {
  notionFetch,
  getString,
  getArray,
  notionErrorMessage,
  resolveDataSourceId,
} from './lib/notion-client.js';

function die(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

/** Returns true if a page with this URL already exists in the data source. */
async function isDuplicate(token: string, dataSourceId: string, url: string): Promise<boolean> {
  const res = await notionFetch(token, 'POST', `data_sources/${dataSourceId}/query`, {
    filter: { property: 'URL', url: { equals: url } },
    page_size: 1,
  });
  if (!res.ok) return false;
  const results = getArray(res.json, 'results');
  return (results?.length ?? 0) > 0;
}

async function addArticle(token: string, dataSourceId: string, url: string): Promise<void> {
  process.stdout.write(`  Fetching ${url} … `);

  // 1. Fetch and parse the article
  let article;
  try {
    article = await fetchArticle(url);
  } catch (err) {
    console.log('✖ fetch failed');
    console.error(`    ${String(err)}`);
    return;
  }

  // 2. Deduplicate
  const dup = await isDuplicate(token, dataSourceId, article.url);
  if (dup) {
    console.log('— already in database, skipping');
    return;
  }

  // 3. Infer metadata
  const publication = inferPublication(article.url);
  const topics = inferTopics(article.headline, article.bodyText);
  const location = inferLocation(article.headline, article.bodyText);

  // 4. Build page properties
  const properties: Record<string, unknown> = {
    Headline: { title: [{ type: 'text', text: { content: article.headline } }] },
    URL: { url: article.url },
  };
  if (article.publishedIso) {
    properties['Published'] = { date: { start: article.publishedIso } };
  }
  if (publication) {
    properties['Publication'] = { select: { name: publication } };
  }
  if (topics.length > 0) {
    properties['Topics'] = { multi_select: topics.map((t) => ({ name: t })) };
  }
  if (location) {
    properties['Location'] = { select: { name: location } };
  }

  // 5. Create the page under the data source
  const page = await notionFetch(token, 'POST', 'pages', {
    parent: { type: 'data_source_id', data_source_id: dataSourceId },
    properties,
  });

  if (!page.ok) {
    console.log('✖ create failed');
    console.error(`    HTTP ${page.status}: ${notionErrorMessage(page.json)}`);
    return;
  }

  const pageId = getString(page.json, 'id');
  console.log(`✓ created`);

  // 6. Add body text as paragraph blocks (Notion accepts max 100 per request)
  if (article.bodyText && pageId) {
    const blocks = makeParagraphBlocks(article.bodyText);
    for (let i = 0; i < blocks.length; i += 100) {
      await notionFetch(token, 'PATCH', `blocks/${pageId}/children`, {
        children: blocks.slice(i, i + 100),
      });
    }
  }
}

async function main(): Promise<void> {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    die(
      'Usage: pnpm add:transit-news <url> [url ...]\n' +
        '  Example: pnpm add:transit-news https://nevadacurrent.com/2026/01/01/some-article/',
    );
  }

  const env = parseEnvFile(path.join(process.cwd(), '.env.local'));
  const readEnv = (key: string): string => (env.get(key) ?? process.env[key] ?? '').trim();

  const token = readEnv('LVBT_NOTION_API_KEY');
  if (!token) {
    die(
      'LVBT_NOTION_API_KEY is not set in .env.local.\n' +
        '  Create an internal integration at https://www.notion.so/my-integrations,\n' +
        '  connect it to the Transit News database (••• → Connections),\n' +
        '  then add the token to .env.local.',
    );
  }

  const databaseId = readEnv('LVBT_TRANSIT_NEWS_DB_ID');
  if (!databaseId) {
    die(
      'LVBT_TRANSIT_NEWS_DB_ID is not set in .env.local.\n' +
        '  Copy it from the Transit News database URL in Notion (the 32-char ID).',
    );
  }

  const dataSourceId = await resolveDataSourceId(token, databaseId);
  if (!dataSourceId) {
    die(
      `Could not resolve a data source for database ${databaseId}.\n` +
        '  Confirm LVBT_TRANSIT_NEWS_DB_ID is correct and the integration is\n' +
        '  connected to that database (••• → Connections).',
    );
  }

  console.log(`Adding ${urls.length} article(s) to Transit News database…\n`);

  for (const url of urls) {
    await addArticle(token, dataSourceId, url);
  }

  console.log('\nDone.');
}

await main();
