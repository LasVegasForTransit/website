import assert from 'node:assert/strict';
import test from 'node:test';
import { exportRosterSources } from '../scripts/platform/roster-source-export';

const config = {
  beehiivKey: 'source-test',
  publicationId: 'pub_test',
  notionKey: 'notion-test',
  dataSourceId: '00000000-0000-4000-8000-000000000000',
};
void test('source export reads all statuses and every cursor page, including original Notion answer children', async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const fetcher: typeof fetch = (input, init) =>
    Promise.resolve().then(() => {
      const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        ),
        method = init?.method ?? 'GET';
      requests.push({ url: url.pathname + url.search, method });
      assert.ok(
        method === 'GET' || (method === 'POST' && url.pathname.endsWith('/query')),
        'source collection must never mutate a provider',
      );
      if (url.hostname === 'api.beehiiv.com') {
        assert.equal(url.searchParams.get('status'), 'all');
        assert.equal(url.searchParams.get('expand[]'), 'custom_fields');
        return Response.json(
          url.searchParams.has('cursor')
            ? {
                data: [{ id: 'sub_inactive', status: 'inactive' }],
                has_more: false,
                next_cursor: null,
              }
            : {
                data: [{ id: 'sub_active', status: 'active' }],
                has_more: true,
                next_cursor: 'next',
              },
        );
      }
      if (url.pathname.endsWith('/query')) {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          start_cursor?: string;
        };
        return Response.json(
          body.start_cursor
            ? { results: [{ id: 'page_second' }], has_more: false, next_cursor: null }
            : { results: [{ id: 'page_first' }], has_more: true, next_cursor: 'notion-next' },
        );
      }
      if (url.pathname.includes('page_first'))
        return Response.json({
          results: [{ id: 'answer_parent', has_children: true }],
          has_more: false,
        });
      return Response.json({
        results: [{ id: `leaf_${requests.length}`, has_children: false }],
        has_more: false,
      });
    });
  const snapshot = await exportRosterSources(config, fetcher);
  assert.equal(snapshot.beehiiv.length, 2);
  assert.equal(snapshot.notion.length, 2);
  assert.ok(requests.some((request) => request.url.includes('answer_parent/children')));
  assert.ok(requests.some((request) => request.url.includes('cursor=next')));
});
void test('repeated provider identities abort an incomplete export instead of silently skipping rows', async () => {
  const fetcher: typeof fetch = () =>
    Promise.resolve(
      Response.json({ data: [{ id: 'sub_same' }, { id: 'sub_same' }], has_more: false }),
    );
  await assert.rejects(exportRosterSources(config, fetcher), /repeated/);
});
