import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { memoryDb, seedActiveWorkRoute } from './support/db';
import {
  saveProjectHome,
  saveWorkConversation,
  readWorkConversation,
  commitManagedForumTags,
} from '../src/discord-work-links';
import { enqueueWorkOperation, claimWorkOperation } from '../src/discord-work-operations';

void test('managed tag ownership is fenced by the current operation, route, and conversation', async () => {
  const db = memoryDb();
  const scope = {
    environment: 'preview' as const,
    guildId: '222222222222222222',
    workspaceId: 'workspace',
  };
  const now = new Date('2026-10-22T12:00:00Z'),
    forumId = '333333333333333333',
    threadId = '555555555555555555',
    tagId = '777777777777777777';
  const home = {
    id: 'home',
    scope,
    projectSourceId: '10000000-0000-4000-8000-000000000003',
    projectId: '10000000-0000-4000-8000-000000000004',
    destination: { kind: 'forum' as const, channelId: forumId, parentId: null },
    taskParent: null,
    audienceFingerprint: 'audience',
    approvedBy: 'person',
    state: 'active' as const,
    generation: 1,
  };
  const conversation = {
    id: 'conversation',
    scope,
    subject: {
      kind: 'project_plan' as const,
      sourceId: home.projectSourceId,
      pageId: home.projectId,
    },
    homeId: home.id,
    placementProjectId: home.projectId,
    threadId,
    starterMessageId: threadId,
    mode: 'selected' as const,
    state: 'active' as const,
    generation: 1,
    activationId: threadId,
    cursorId: threadId,
    windowUpperId: null,
    windowBeforeId: null,
    footerBlockIds: [],
  };
  try {
    await saveProjectHome(db, home, 0, now);
    await saveWorkConversation(db, conversation, 0, now);
    seedActiveWorkRoute(
      db,
      {
        id: 'route',
        scope,
        sourceId: home.projectSourceId,
        kind: 'project',
        state: 'active',
        revision: 1,
        trigger: { property: 'Status', values: ['Ready'] },
        destination: { kind: 'category', channelId: forumId },
        tagSync: { property: 'Status', mappings: [{ value: 'Ready', tagName: 'Ready' }] },
        approvedBy: 'person',
        audienceFingerprint: 'audience',
      },
      now,
    );
    await enqueueWorkOperation(
      db,
      {
        id: 'operation',
        scope,
        homeId: home.id,
        conversationId: conversation.id,
        generation: 1,
        kind: 'refresh',
        sourceKey: 'tags:test',
        actorPersonId: null,
        actorDiscordId: '111111111111111111',
        grantVersion: 'grant',
        originalAuthorId: '111111111111111111',
        payload: { intent: 'tag-sync', routeId: 'route', routeRevision: 1 },
      },
      now,
    );
    const operation = await claimWorkOperation(db, scope, now);
    assert.ok(operation);
    const input = {
      conversation,
      operationId: operation.id,
      claimToken: operation.claim_token,
      routeId: 'route',
      routeRevision: 1,
      previous: null,
      tagIds: [tagId],
    };
    assert.equal(await commitManagedForumTags(db, { ...input, claimToken: 'wrong' }, now), false);
    assert.equal(await commitManagedForumTags(db, { ...input, routeRevision: 2 }, now), false);
    assert.equal(await commitManagedForumTags(db, input, now), true);
    assert.deepEqual((await readWorkConversation(db, scope, conversation.id))?.managedForumTags, {
      routeId: 'route',
      tagIds: [tagId],
    });
    assert.equal(await commitManagedForumTags(db, input, now), false);
    assert.equal((await readWorkConversation(db, scope, conversation.id))?.cursorId, threadId);
    db.raw.exec('DROP INDEX discord_work_one_active_tag_sync');
    assert.equal(
      await enqueueWorkOperation(
        db,
        {
          id: 'second',
          scope,
          homeId: home.id,
          conversationId: conversation.id,
          generation: 1,
          kind: 'refresh',
          sourceKey: 'tags:second',
          actorPersonId: null,
          actorDiscordId: '111111111111111111',
          grantVersion: 'grant',
          originalAuthorId: '111111111111111111',
          payload: { intent: 'tag-sync', routeId: 'route', routeRevision: 1 },
        },
        now,
      ),
      'queued',
    );
    const migration = readFileSync(
      new URL('../migrations/0064_discord_work_tag_serialization.sql', import.meta.url),
      'utf8',
    );
    assert.throws(() => db.raw.exec(migration), /UNIQUE constraint failed/);
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM discord_work_operations WHERE kind='refresh'").get()
        ?.n,
      2,
    );
  } finally {
    db.raw.close();
  }
});
