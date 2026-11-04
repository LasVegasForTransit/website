import assert from 'node:assert/strict';
import test from 'node:test';
import {
  saveProjectHome,
  saveWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  enqueueWorkOperation,
  claimWorkOperation,
  settleWorkOperation,
  queueFooterReconciliation,
  readWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { resolveWorkActor } from '../src/discord-work-authority';
import { DiscordWorkClient } from '../src/discord-work-provider';
import {
  workFixture,
  workScope,
  workNow,
  sourceId,
  taskId,
  projectId,
  projectSourceId,
  discordUserId,
} from './support/discord-work';
void test('shared status writes recheck assignment and refresh only the same bot card', async () => {
  const module = await import('../src/discord-work-actions').catch(() => null);
  assert.ok(module, 'shared durable actions exist');
  const { db, notion, task } = workFixture();
  let writes = 0,
    edits = 0;
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  const destination = {
    destination: {
      kind: 'thread' as const,
      channelId: '555555555555555555',
      parentId: '333333333333333333',
    },
    audienceFingerprint: 'audience',
    archived: false,
    locked: false,
    canRead: true,
    canSend: true,
    canCreateThreads: true,
    canManageChannels: false,
    requiredTag: false,
    tags: [],
  };
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: () => Promise.resolve(destination),
    editCard: (input: { messageId: string }) => {
      assert.equal(input.messageId, '555555555555555555');
      edits++;
      return Promise.resolve();
    },
  });
  Object.assign(notion, {
    setTaskStatus: (_id: string, _field: string, status: string) => {
      writes++;
      task.properties.Status.status.name = status;
      return Promise.resolve(task);
    },
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
    const actor = await resolveWorkActor(db, workScope, discordUserId);
    assert.ok(actor);
    const intent = {
      id: 'status',
      scope: workScope,
      homeId: 'home',
      conversationId: 'conversation',
      generation: 1,
      kind: 'status' as const,
      sourceKey: 'interaction:one',
      actorPersonId: 'guest',
      actorDiscordId: discordUserId,
      grantVersion: actor.grantVersion,
      originalAuthorId: discordUserId,
      payload: { status: 'In progress' },
    };
    await enqueueWorkOperation(db, intent, workNow);
    const first = await claimWorkOperation(db, workScope, workNow);
    assert.ok(first);
    const context = {
      scope: workScope,
      taskSourceId: sourceId,
      enabled: true,
      clock: () => workNow,
    };
    assert.equal(
      (await module.processWorkAction(db, { notion, discord }, first, context)).kind,
      'progress',
    );
    assert.equal(writes, 1);
    assert.equal(edits, 1);
    await enqueueWorkOperation(
      db,
      { ...intent, id: 'revoked', sourceKey: 'interaction:two' },
      workNow,
    );
    const second = await claimWorkOperation(db, workScope, workNow);
    assert.ok(second);
    task.properties.Assignee.people = [];
    assert.equal(
      (await module.processWorkAction(db, { notion, discord }, second, context)).kind,
      'idle',
    );
    assert.equal(writes, 1);
    assert.equal(edits, 1);
  } finally {
    db.raw.close();
  }
});

void test('scheduled footer repair rechecks the original actor before writing to Notion', async () => {
  const { processWorkAction } = await import('../src/discord-work-actions');
  const { db, notion, task } = workFixture();
  let writes = 0;
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(discord, { membership: () => Promise.resolve(true) });
  Object.assign(notion, {
    appendBlockChildren: () => {
      writes++;
      return Promise.resolve({});
    },
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
    const actor = await resolveWorkActor(db, workScope, discordUserId);
    assert.ok(actor);
    await enqueueWorkOperation(
      db,
      {
        id: 'backlink',
        scope: workScope,
        homeId: 'home',
        conversationId: 'conversation',
        generation: 1,
        kind: 'backlink',
        sourceKey: 'backlink:conversation',
        actorPersonId: actor.personId,
        actorDiscordId: discordUserId,
        originalAuthorId: discordUserId,
        grantVersion: actor.grantVersion,
        payload: {},
      },
      workNow,
    );
    const first = await claimWorkOperation(db, workScope, workNow);
    assert.ok(first);
    await settleWorkOperation(
      db,
      { id: first.id, token: first.claim_token },
      { state: 'confirmed' },
      workNow,
    );
    const now = new Date(workNow.getTime() + 60_001);
    assert.equal(await queueFooterReconciliation(db, conversation, now), true);
    task.properties.Assignee.people = [];
    const next = await claimWorkOperation(db, workScope, now);
    assert.ok(next);
    const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => now };
    assert.equal((await processWorkAction(db, { notion, discord }, next, context)).kind, 'idle');
    assert.equal((await readWorkOperation(db, workScope, next.id))?.state, 'superseded');
    assert.equal(writes, 0);
  } finally {
    db.raw.close();
  }
});

void test('a deleted forum tag is a known pre-send failure, not an uncertain creation', async () => {
  const { workFailure } = await import('../src/discord-work-actions');
  assert.deepEqual(workFailure(new Error('invalid_forum_tag')), {
    state: 'failed',
    reason: 'invalid_forum_tag',
  });
});
