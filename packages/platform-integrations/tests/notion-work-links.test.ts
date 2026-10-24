import assert from 'node:assert/strict';
import test from 'node:test';
import { NotionTaskClient } from '../src/notion-task-client';
import {
  workFixture,
  workScope,
  workNow,
  sourceId,
  taskId,
  projectId,
  projectSourceId,
} from './support/discord-work';
void test('managed Notion footers reuse a positive bot-authored link after an interrupted save', async () => {
  const module = await import('../src/notion-work-links').catch(() => null);
  assert.ok(module, 'managed reciprocal links exist');
  const { saveProjectHome, saveWorkConversation } =
    await import('@lasvegasfortransit/platform-storage/discord-work-links');
  const { db } = workFixture();
  const blocks: unknown[] = [];
  let writes = 0;
  const client = new NotionTaskClient('fixture-only', (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith('/users/me'))
      return Promise.resolve(Response.json({ id: 'bot', type: 'bot' }));
    if (init?.method === 'PATCH') {
      writes++;
      const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as {
        children: Record<string, unknown>[];
      };
      const results = body.children.map((b, i) => ({
        ...b,
        id: `block-${i}`,
        created_by: { id: 'bot' },
      }));
      blocks.push(...results);
      return Promise.resolve(
        Response.json({ object: 'list', results, has_more: false, next_cursor: null }),
      );
    }
    return Promise.resolve(
      Response.json({ object: 'list', results: blocks, has_more: false, next_cursor: null }),
    );
  });
  const home = {
    id: 'home',
    scope: workScope,
    projectSourceId,
    projectId,
    destination: { kind: 'forum' as const, channelId: '333333333333333333', parentId: null },
    taskParent: null,
    audienceFingerprint: 'audience',
    approvedBy: 'guest',
    state: 'active' as const,
    generation: 1,
  };
  const conversation = {
    id: 'conversation',
    scope: workScope,
    subject: { kind: 'task' as const, sourceId, pageId: taskId },
    homeId: 'home',
    placementProjectId: projectId,
    threadId: '555555555555555555',
    starterMessageId: '555555555555555555',
    mode: 'automatic' as const,
    state: 'active' as const,
    generation: 1,
    activationId: '555555555555555555',
    cursorId: '555555555555555555',
    windowUpperId: null,
    windowBeforeId: null,
    footerBlockIds: [],
  };
  try {
    await saveProjectHome(db, home, 0, workNow);
    await saveWorkConversation(db, conversation, 0, workNow);
    assert.equal(
      (await module.ensureNotionWorkLink(db, client, conversation, workNow)).kind,
      'progress',
    );
    assert.equal(
      (await module.ensureNotionWorkLink(db, client, conversation, workNow)).kind,
      'progress',
    );
    assert.equal(writes, 1);
    assert.equal(blocks.length, 2);
  } finally {
    db.raw.close();
  }
});
