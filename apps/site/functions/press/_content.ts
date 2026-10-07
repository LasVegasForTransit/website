import { NOTION_VERSION } from '../api/_notion.js';

export interface PressEntry {
  outlet: string;
  title: string;
  publishedAt: string;
  url: string;
}

const NOTION_API = 'https://api.notion.com/v1';
const PAGE_SIZE = 100;

type RecordValue = Record<string, unknown>;

export interface PressCache {
  match(request: Request): Promise<Response | null | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function property(page: unknown, name: string): RecordValue | undefined {
  if (!isRecord(page) || !isRecord(page.properties)) return undefined;
  const value = page.properties[name];
  return isRecord(value) ? value : undefined;
}

function textValue(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      if (!isRecord(item)) return '';
      if (typeof item.plain_text === 'string') return item.plain_text;
      const text = item.text;
      return isRecord(text) && typeof text.content === 'string' ? text.content : '';
    })
    .join('')
    .trim();
}

function titleFromPage(page: unknown): string {
  const headline = property(page, 'Headline');
  return headline?.type === 'title' ? textValue(headline.title) : '';
}

function outletFromPage(page: unknown): string {
  const outlet = property(page, 'Outlet');
  return outlet?.type === 'rich_text' ? textValue(outlet.rich_text) : '';
}

function publishedAtFromPage(page: unknown): string {
  const published = property(page, 'Published');
  if (published?.type !== 'date' || !isRecord(published.date)) return '';
  const start = published.date.start;
  return typeof start === 'string' && !Number.isNaN(Date.parse(start)) ? start : '';
}

function urlFromPage(page: unknown): string {
  const urlProperty = property(page, 'URL');
  const value = urlProperty?.type === 'url' ? urlProperty.url : undefined;
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function entryFromPage(page: unknown): PressEntry | undefined {
  const outlet = outletFromPage(page);
  const title = titleFromPage(page);
  const publishedAt = publishedAtFromPage(page);
  const url = urlFromPage(page);
  return outlet && title && publishedAt && url ? { outlet, title, publishedAt, url } : undefined;
}

async function queryPage(
  token: string,
  dataSourceId: string,
  cursor: string | undefined,
  fetcher: typeof fetch,
): Promise<{ pages: unknown[]; nextCursor?: string }> {
  const response = await fetcher(`${NOTION_API}/data_sources/${dataSourceId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify({
      page_size: PAGE_SIZE,
      sorts: [{ property: 'Published', direction: 'descending' }],
      ...(cursor ? { start_cursor: cursor } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Notion press query failed with HTTP ${response.status}`);

  const result: unknown = await response.json();
  if (!isRecord(result)) throw new Error('Notion press query returned an invalid response');
  if (!Array.isArray(result.results)) throw new Error('Notion press query omitted results');

  const nextCursor = result.has_more === true ? result.next_cursor : undefined;
  if (result.has_more === true && typeof nextCursor !== 'string') {
    throw new Error('Notion press query omitted its next cursor');
  }
  return {
    pages: result.results,
    ...(typeof nextCursor === 'string' ? { nextCursor } : {}),
  };
}

/** Load complete, safe-to-publish rows from the staff-managed Notion database. */
export async function fetchPressEntries(
  token: string,
  dataSourceId: string,
  fetcher: typeof fetch = fetch,
): Promise<PressEntry[]> {
  const entries: PressEntry[] = [];
  let cursor: string | undefined;

  do {
    const page = await queryPage(token, dataSourceId, cursor, fetcher);
    entries.push(...page.pages.map(entryFromPage).filter((entry) => entry !== undefined));
    cursor = page.nextCursor;
  } while (cursor);

  return entries.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/** Cache Notion reads for five minutes per data source so staff edits need no deploy. */
export async function loadPressEntries({
  token,
  dataSourceId,
  requestUrl,
  fetcher = fetch,
  cache,
}: {
  token: string;
  dataSourceId: string;
  requestUrl: string;
  fetcher?: typeof fetch;
  cache: PressCache;
}): Promise<PressEntry[]> {
  const cacheUrl = new URL('/__lvbt/press-entries.json', requestUrl);
  cacheUrl.searchParams.set('source', dataSourceId);
  const cacheKey = new Request(cacheUrl);
  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const value: unknown = await cached.json();
      if (Array.isArray(value)) return value as PressEntry[];
    }
  } catch {
    // The cache is only an optimization; a cache miss or read failure falls through to Notion.
  }

  const entries = await fetchPressEntries(token, dataSourceId, fetcher);
  try {
    await cache.put(
      cacheKey,
      Response.json(entries, { headers: { 'Cache-Control': 'public, max-age=300' } }),
    );
  } catch {
    // A cache write failure must not prevent a successful press-page response.
  }
  return entries;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function renderPressEntries(entries: PressEntry[]): string {
  if (entries.length === 0) {
    return '<li class="col-span-full"><p class="text-body-lg">No press coverage has been published yet.</p></li>';
  }

  return entries
    .map((entry) => {
      const date = new Date(entry.publishedAt);
      const datetime = date.toISOString().slice(0, 10);
      const displayDate = date.toLocaleDateString('en-US', {
        dateStyle: 'long',
        timeZone: 'UTC',
      });
      return `
        <li>
          <article class="h-full">
            <a
              class="group flex h-full flex-col text-on-surface no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-primary-ink"
              href="${escapeAttribute(entry.url)}"
              target="_blank"
              rel="noopener noreferrer"
              data-external-icon="false"
            >
              <h2 class="flex items-start gap-4 text-headline-sm md:text-headline-md">
                <span class="min-w-0 flex-1 text-pretty transition-colors group-hover:text-primary-ink group-focus-visible:text-primary-ink">${escapeHtml(entry.title)}</span>
                <span class="shrink-0 text-title-lg text-on-surface-variant" aria-hidden="true">↗</span>
              </h2>
              <p class="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-body-sm text-on-surface-variant">
                <span class="font-semibold text-on-surface">${escapeHtml(entry.outlet)}</span>
                <span aria-hidden="true">·</span>
                <time datetime="${escapeAttribute(datetime)}">${escapeHtml(displayDate)}</time>
              </p>
            </a>
          </article>
        </li>
      `;
    })
    .join('');
}
