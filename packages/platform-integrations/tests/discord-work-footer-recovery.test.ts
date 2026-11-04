import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enqueueWorkOperation,
  claimWorkOperation,
  settleWorkOperation,
  readWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { recoverOneWorkOperation } from '../src/discord-work-recovery';
import { DiscordWorkClient } from '../src/discord-work-provider';
import {
  readWorkConversation,
  saveProjectHome,
  saveWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  workFixture,
  workScope,
  workNow,
  sourceId,
  projectSourceId,
  projectId,
  taskId,
  discordUserId,
} from './support/discord-work';

void test('an uncertain footer move is retried instead of confirming a duplicate footer', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
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
    footerBlockIds: ['00000000000000000000000000000001', '00000000000000000000000000000002'],
  };
  const footerUrl = `https://discord.com/channels/${workScope.guildId}/${conversation.threadId}?lvbt_work=conversation`;
  const divider = (id: string) => ({ id, type: 'divider', created_by: { id: 'bot' } });
  const link = (id: string) => ({
    id,
    type: 'paragraph',
    created_by: { id: 'bot' },
    paragraph: {
      rich_text: [
        {
          type: 'text',
          text: { content: 'Open the Discord conversation', link: { url: footerUrl } },
        },
      ],
    },
  });
  Object.assign(notion, {
    readSelf: () => Promise.resolve({ id: 'bot', type: 'bot' }),
    listBlockChildren: () =>
      Promise.resolve({
        results: [
          divider('00000000000000000000000000000001'),
          link('00000000000000000000000000000002'),
          {
            id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            type: 'paragraph',
            created_by: { id: 'organizer' },
          },
          divider('00000000000000000000000000000003'),
          link('00000000000000000000000000000004'),
        ],
        nextCursor: null,
      }),
  });
  let now = workNow;
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => now };
  try {
    await saveProjectHome(db, home, 0, now);
    await saveWorkConversation(db, conversation, 0, now);
    await enqueueWorkOperation(
      db,
      {
        id: 'footer-recovery',
        scope: workScope,
        homeId: 'home',
        conversationId: 'conversation',
        generation: 1,
        kind: 'backlink',
        sourceKey: 'backlink:conversation',
        actorPersonId: 'guest',
        actorDiscordId: discordUserId,
        originalAuthorId: discordUserId,
        grantVersion: 'grant',
        payload: {},
      },
      now,
    );
    const op = await claimWorkOperation(db, workScope, now);
    assert.ok(op);
    await settleWorkOperation(db, { id: op.id, token: op.claim_token }, { state: 'held' }, now);
    now = new Date(now.getTime() + 60_001);
    assert.equal(
      (await recoverOneWorkOperation(db, { discord, notion }, context)).kind,
      'progress',
    );
    assert.equal((await readWorkOperation(db, workScope, op.id))?.state, 'queued');
    db.raw
      .prepare("UPDATE discord_work_operations SET state='held',next_attempt_at=? WHERE id=?")
      .run(now.toISOString(), op.id);
    const originalList = notion.listBlockChildren.bind(notion);
    Object.assign(notion, {
      listBlockChildren: (...args: Parameters<typeof notion.listBlockChildren>) => {
        db.raw
          .prepare("UPDATE discord_work_operations SET state='confirmed' WHERE id=?")
          .run(op.id);
        return originalList(...args);
      },
    });
    assert.deepEqual(await recoverOneWorkOperation(db, { discord, notion }, context), {
      kind: 'paused',
      reason: 'link_changed',
    });
    db.raw
      .prepare("UPDATE discord_work_operations SET state='held',next_attempt_at=? WHERE id=?")
      .run(now.toISOString(), op.id);
    Object.assign(notion, {
      listBlockChildren: () =>
        Promise.resolve({
          results: [
            {
              id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              type: 'paragraph',
              created_by: { id: 'organizer' },
            },
            divider('00000000000000000000000000000003'),
            link('00000000000000000000000000000004'),
          ],
          nextCursor: null,
        }),
    });
    const completedList = notion.listBlockChildren.bind(notion);
    Object.assign(notion, {
      listBlockChildren: (...args: Parameters<typeof notion.listBlockChildren>) => {
        db.raw
          .prepare("UPDATE discord_work_operations SET state='confirmed' WHERE id=?")
          .run(op.id);
        return completedList(...args);
      },
    });
    assert.deepEqual(await recoverOneWorkOperation(db, { discord, notion }, context), {
      kind: 'paused',
      reason: 'link_changed',
    });
    assert.deepEqual((await readWorkConversation(db, workScope, conversation.id))?.footerBlockIds, [
      '00000000000000000000000000000001',
      '00000000000000000000000000000002',
    ]);
    db.raw
      .prepare("UPDATE discord_work_operations SET state='held',next_attempt_at=? WHERE id=?")
      .run(now.toISOString(), op.id);
    Object.assign(notion, { listBlockChildren: completedList });
    assert.equal(
      (await recoverOneWorkOperation(db, { discord, notion }, context)).kind,
      'progress',
    );
    assert.equal((await readWorkOperation(db, workScope, op.id))?.state, 'confirmed');
    assert.deepEqual((await readWorkConversation(db, workScope, conversation.id))?.footerBlockIds, [
      '00000000000000000000000000000003',
      '00000000000000000000000000000004',
    ]);
  } finally {
    db.raw.close();
  }
});

void test('a checkpointed new forum can resume when no overview write was attempted', async () => {
  const { db, notion } = workFixture();
  const forumId = '333333333333333333';
  const categoryId = '777777777777777777';
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  let allowed = false;
  Object.assign(discord, {
    inspectDestination: () =>
      Promise.resolve({
        destination: { kind: 'forum', channelId: forumId, parentId: categoryId },
        audienceFingerprint: 'audience',
        canRead: true,
        canSend: allowed,
      }),
    discoverWork: () => {
      throw new Error('post discovery should not be needed');
    },
  });
  let now = workNow;
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => now };
  try {
    await enqueueWorkOperation(
      db,
      {
        id: 'forum-only',
        scope: workScope,
        homeId: null,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'forum-only',
        actorPersonId: 'guest',
        actorDiscordId: discordUserId,
        originalAuthorId: discordUserId,
        grantVersion: 'grant',
        payload: {
          intent: 'home',
          linkId: 'home',
          createForum: true,
          destinationId: categoryId,
          audienceFingerprint: 'audience',
          subject: { kind: 'project_plan', sourceId: projectSourceId, pageId: projectId },
        },
      },
      now,
    );
    const op = await claimWorkOperation(db, workScope, now);
    assert.ok(op);
    db.raw
      .prepare('UPDATE discord_work_operations SET result_json=? WHERE id=?')
      .run(JSON.stringify({ forumId, postPhase: 'not_started' }), op.id);
    await settleWorkOperation(db, { id: op.id, token: op.claim_token }, { state: 'held' }, now);
    now = new Date(now.getTime() + 60_001);
    assert.equal((await recoverOneWorkOperation(db, { discord, notion }, context)).kind, 'paused');
    allowed = true;
    db.raw
      .prepare('UPDATE discord_work_operations SET result_json=? WHERE id=?')
      .run(JSON.stringify({ forumId, postPhase: 'attempted' }), op.id);
    now = new Date(now.getTime() + 300_001);
    assert.equal((await recoverOneWorkOperation(db, { discord, notion }, context)).kind, 'paused');
    assert.equal((await readWorkOperation(db, workScope, op.id))?.state, 'held');
    db.raw
      .prepare('UPDATE discord_work_operations SET result_json=? WHERE id=?')
      .run(JSON.stringify({ forumId, postPhase: 'not_started' }), op.id);
    now = new Date(now.getTime() + 300_001);
    assert.equal(
      (await recoverOneWorkOperation(db, { discord, notion }, context)).kind,
      'progress',
    );
    const recovered = await readWorkOperation(db, workScope, op.id);
    assert.equal(recovered?.state, 'queued');
    assert.equal(
      (JSON.parse(recovered.result_json ?? '{}') as { forumId?: string }).forumId,
      forumId,
    );
  } finally {
    db.raw.close();
  }
});
