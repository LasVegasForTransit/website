import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchPressEntries,
  loadPressEntries,
  renderPressEntries,
} from '../functions/press/_content';

function notionPage({
  outlet,
  title,
  publishedAt,
  url,
}: {
  outlet: string;
  title: string;
  publishedAt: string;
  url: string;
}) {
  return {
    properties: {
      Headline: { type: 'title', title: [{ plain_text: title }] },
      Outlet: { type: 'rich_text', rich_text: [{ plain_text: outlet }] },
      Published: { type: 'date', date: { start: publishedAt } },
      URL: { type: 'url', url },
    },
  };
}

void test('fetchPressEntries reads all Notion pages, omits incomplete rows, and sorts newest first', async () => {
  const calls: Array<{ url: string; body: string; headers: Headers }> = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url, body, headers: new Headers(init?.headers) });
    if (calls.length === 1) {
      return Promise.resolve(
        Response.json({
          results: [
            notionPage({
              outlet: 'Older Outlet',
              title: 'Older coverage',
              publishedAt: '2026-04-01',
              url: 'https://example.org/older',
            }),
            {
              properties: {
                Headline: { type: 'title', title: [{ plain_text: 'Draft row' }] },
                Outlet: { type: 'rich_text', rich_text: [{ plain_text: 'No date yet' }] },
                Published: { type: 'date', date: null },
                URL: { type: 'url', url: 'https://example.org/draft' },
              },
            },
            notionPage({
              outlet: 'Invalid link outlet',
              title: 'Unsafe link',
              publishedAt: '2026-08-01',
              url: 'javascript:alert(1)',
            }),
          ],
          has_more: true,
          next_cursor: 'next-page',
        }),
      );
    }
    return Promise.resolve(
      Response.json({
        results: [
          notionPage({
            outlet: 'Newer Outlet',
            title: 'Newer coverage',
            publishedAt: '2026-09-01',
            url: 'https://example.org/newer',
          }),
        ],
        has_more: false,
      }),
    );
  };

  const entries = await fetchPressEntries('notion-token', 'press-data-source', fetcher);

  assert.deepEqual(
    entries.map(({ outlet, title }) => ({ outlet, title })),
    [
      { outlet: 'Newer Outlet', title: 'Newer coverage' },
      { outlet: 'Older Outlet', title: 'Older coverage' },
    ],
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, 'https://api.notion.com/v1/data_sources/press-data-source/query');
  assert.match(calls[0]?.body ?? '', /"page_size":100/);
  assert.match(calls[1]?.body ?? '', /"start_cursor":"next-page"/);
  assert.equal(calls[0]?.headers.get('Authorization'), 'Bearer notion-token');
  assert.equal(calls[0]?.headers.get('Notion-Version'), '2026-03-11');
});

void test('renderPressEntries escapes Notion text and links only to validated article URLs', () => {
  const markup = renderPressEntries([
    {
      outlet: '<News & Co>',
      title: 'Coverage <script>alert(1)</script>',
      publishedAt: '2026-09-01',
      url: 'https://example.org/story?x=1&y=2',
    },
  ]);

  assert.match(markup, /&lt;News &amp; Co&gt;/);
  assert.match(markup, /Coverage &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(markup, /https:\/\/example\.org\/story\?x=1&amp;y=2/);
  assert.doesNotMatch(markup, /<script>/);
});

void test('renderPressEntries returns the archive empty state for zero valid entries', () => {
  assert.match(renderPressEntries([]), /No press coverage has been published yet\./);
});

void test('loadPressEntries caches each Notion data source separately for five minutes', async () => {
  let reads = 0;
  const stored = new Map<string, Response>();
  const cache = {
    match: (request: Request) => Promise.resolve(stored.get(request.url)?.clone()),
    put: (request: Request, response: Response) => {
      stored.set(request.url, response.clone());
      return Promise.resolve();
    },
  };
  const fetcher: typeof fetch = (input) => {
    reads += 1;
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const dataSourceId = url.pathname.split('/').at(-2) ?? 'unknown';
    return Promise.resolve(
      Response.json({
        results: [
          notionPage({
            outlet: `${dataSourceId} Outlet`,
            title: 'Example coverage',
            publishedAt: '2026-09-01',
            url: `https://example.org/${dataSourceId}`,
          }),
        ],
        has_more: false,
      }),
    );
  };

  const options = {
    token: 'notion-token',
    dataSourceId: 'press-data-source',
    requestUrl: 'https://lasvegasfortransit.org/press/',
    fetcher,
    cache,
  };
  const first = await loadPressEntries(options);
  const second = await loadPressEntries(options);
  const otherSource = await loadPressEntries({ ...options, dataSourceId: 'another-source' });

  assert.deepEqual(second, first);
  assert.notDeepEqual(otherSource, first);
  assert.equal(reads, 2);
  assert.match([...stored.values()][0]?.headers.get('Cache-Control') ?? '', /max-age=300/);
});
