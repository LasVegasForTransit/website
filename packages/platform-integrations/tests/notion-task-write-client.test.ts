import assert from 'node:assert/strict';
import test from 'node:test';
import { NotionTaskClient, NotionTaskApiError } from '../src/notion-task-client';

const pageId = '10000000-0000-4000-8000-000000000002';
void test('writes comments and completion without replacing any unrelated Notion properties', async () => {
  const requests: { url: string; method: string; body: unknown }[] = [];
  const client = new NotionTaskClient('test-token', (input, init) => {
    requests.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? '',
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '') as unknown,
    });
    return Promise.resolve(Response.json({ object: 'comment', id: pageId }));
  });
  await client.createTaskComment(pageId, [
    { type: 'text', text: { content: 'Progress from Discord' } },
  ]);
  await client.completeTask(pageId, 'Status');
  assert.deepEqual(requests, [
    {
      url: 'https://api.notion.com/v1/comments',
      method: 'POST',
      body: {
        parent: { page_id: pageId },
        rich_text: [{ type: 'text', text: { content: 'Progress from Discord' } }],
      },
    },
    {
      url: `https://api.notion.com/v1/pages/${pageId}`,
      method: 'PATCH',
      body: { properties: { Status: { status: { name: 'Done' } } } },
    },
  ]);
});
void test('distinguishes rejected writes from uncertain effects without exposing provider text', async () => {
  for (const status of [400, 403, 429, 500, 503]) {
    const client = new NotionTaskClient('test-token', () =>
      Promise.resolve(new Response('PRIVATE', { status })),
    );
    await assert.rejects(client.createTaskComment(pageId, []), (error: unknown) => {
      assert.ok(error instanceof NotionTaskApiError);
      assert.equal(error.effectMayHaveApplied, status >= 500);
      assert.equal(error.message.includes('PRIVATE'), false);
      return true;
    });
  }
  const client = new NotionTaskClient('test-token', () => Promise.reject(new Error('PRIVATE')));
  await assert.rejects(client.createTaskComment(pageId, []), (error: unknown) => {
    assert.ok(error instanceof NotionTaskApiError);
    assert.equal(error.effectMayHaveApplied, true);
    return true;
  });
  const malformed = new NotionTaskClient('test-token', () => Promise.resolve(new Response('{')));
  await assert.rejects(malformed.createTaskComment(pageId, []), (error: unknown) => {
    assert.ok(error instanceof NotionTaskApiError);
    assert.equal(error.effectMayHaveApplied, true);
    return true;
  });
});
void test('lists comments using bounded pagination for positive reconciliation', async () => {
  const urls: string[] = [];
  const client = new NotionTaskClient('test-token', (input) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(Response.json({ results: [], has_more: false, next_cursor: null }));
  });
  assert.deepEqual(await client.listTaskComments(pageId, 'next'), {
    results: [],
    nextCursor: null,
  });
  assert.equal(
    urls[0],
    `https://api.notion.com/v1/comments?block_id=${pageId}&page_size=100&start_cursor=next`,
  );
});

void test('native fetch keeps the Workers global receiver when explicitly supplied', async () => {
  function nativeFetch(this: unknown): Promise<Response> {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    return Promise.resolve(Response.json({ id: pageId, object: 'page' }));
  }
  const client = new NotionTaskClient('fixture-only', nativeFetch);
  assert.equal(((await client.readPage(pageId)) as { id: string }).id, pageId);
});
