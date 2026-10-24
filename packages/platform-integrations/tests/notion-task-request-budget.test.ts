import assert from 'node:assert/strict';
import test from 'node:test';
import { NotionTaskClient } from '../src/notion-task-client';
import { pageId, now } from './support/task-action-fixture';
void test('escalation provider reads stop at their shared request count or deadline before starting another request', async () => {
  let calls = 0;
  const fetcher: typeof fetch = () => {
    calls++;
    return Promise.resolve(Response.json({ object: 'page', id: pageId }));
  };
  const client = new NotionTaskClient('fixture', fetcher, {
    maxRequests: 1,
    deadline: now.getTime() + 10000,
    clock: () => now,
  });
  await client.readPage(pageId);
  await assert.rejects(client.readPage(pageId), /request_budget_exceeded/);
  assert.equal(calls, 1);
  const expired = new NotionTaskClient('fixture', fetcher, {
    maxRequests: 20,
    deadline: now.getTime(),
    clock: () => now,
  });
  await assert.rejects(expired.readPage(pageId), /request_budget_exceeded/);
  assert.equal(calls, 1);
});
void test('Notion throttling records shared backoff and blocks another request from the same client', async () => {
  let calls = 0;
  const delays: number[] = [];
  const client = new NotionTaskClient(
    'fixture',
    () => {
      calls++;
      return Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '300' } }));
    },
    undefined,
    (delay) => {
      delays.push(delay);
      return Promise.resolve();
    },
  );
  await assert.rejects(client.readPage(pageId), /http_429/);
  assert.deepEqual(delays, [300000]);
  await assert.rejects(client.readPage(pageId), /provider_cooldown/);
  assert.equal(calls, 1);
});
void test('a transport failure saves shared wait without losing the uncertainty of a Notion write', async () => {
  const delays: number[] = [];
  const client = new NotionTaskClient(
    'fixture',
    () => Promise.reject(new Error('fixture connection lost')),
    undefined,
    (delay) => {
      delays.push(delay);
      return Promise.resolve();
    },
  );
  await assert.rejects(client.createTaskComment(pageId, []), (error) => {
    assert.ok(error instanceof Error && 'effectMayHaveApplied' in error);
    assert.equal(error.effectMayHaveApplied, true);
    return true;
  });
  assert.deepEqual(delays, [60000]);
});
