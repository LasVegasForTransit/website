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
  discordUserId,
} from './support/discord-work';

void test('a saved overview and matching checkpoint allow interrupted provisioning to resume', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(discord, { discoverWork: () => Promise.resolve(null) });
  const forumId = '333333333333333333',
    threadId = '555555555555555555';
  const subject = { kind: 'project_plan' as const, sourceId: projectSourceId, pageId: projectId };
  const home = {
    id: 'home',
    scope: workScope,
    projectSourceId,
    projectId,
    destination: { kind: 'forum' as const, channelId: forumId, parentId: null },
    taskParent: null,
    audienceFingerprint: 'audience',
    approvedBy: 'guest',
    state: 'active' as const,
    generation: 1,
  };
  const conversation = {
    id: 'overview-home',
    scope: workScope,
    subject,
    homeId: 'home',
    placementProjectId: projectId,
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
  let now = workNow;
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => now };
  try {
    await saveProjectHome(db, home, 0, now);
    await saveWorkConversation(db, conversation, 0, now);
    await enqueueWorkOperation(
      db,
      {
        id: 'resume',
        scope: workScope,
        homeId: 'home',
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'resume',
        actorPersonId: 'guest',
        actorDiscordId: discordUserId,
        originalAuthorId: discordUserId,
        grantVersion: 'grant',
        payload: { intent: 'home', linkId: 'home', subject, destinationId: forumId },
      },
      now,
    );
    const op = await claimWorkOperation(db, workScope, now);
    assert.ok(op);
    db.raw
      .prepare('UPDATE discord_work_operations SET result_json=? WHERE id=?')
      .run(JSON.stringify({ forumId, threadId: 'wrong', starterMessageId: threadId }), op.id);
    await settleWorkOperation(db, { id: op.id, token: op.claim_token }, { state: 'held' }, now);
    now = new Date(now.getTime() + 60_001);
    assert.equal((await recoverOneWorkOperation(db, { discord, notion }, context)).kind, 'paused');
    db.raw
      .prepare('UPDATE discord_work_operations SET result_json=? WHERE id=?')
      .run(JSON.stringify({ forumId, threadId, starterMessageId: threadId }), op.id);
    now = new Date(now.getTime() + 300_001);
    assert.equal(
      (await recoverOneWorkOperation(db, { discord, notion }, context)).kind,
      'progress',
    );
    assert.equal((await readWorkOperation(db, workScope, op.id))?.state, 'queued');
  } finally {
    db.raw.close();
  }
});
void test('an uncertain overview preserves its forum checkpoint and needs positive post evidence before resuming', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  const forumId = '333333333333333333';
  let proof: { forumId: string; threadId?: string; starterMessageId?: string } = { forumId };
  Object.assign(discord, { discoverWork: () => Promise.resolve(proof) });
  let now = workNow;
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => now };
  try {
    await enqueueWorkOperation(
      db,
      {
        id: 'creation',
        scope: workScope,
        homeId: null,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'setup:creation',
        actorPersonId: 'guest',
        actorDiscordId: discordUserId,
        originalAuthorId: discordUserId,
        grantVersion: 'grant',
        payload: {
          intent: 'home',
          linkId: 'home',
          createForum: true,
          destinationId: '777777777777777777',
          subject: { kind: 'project_plan', sourceId: projectSourceId, pageId: projectId },
        },
      },
      now,
    );
    const op = await claimWorkOperation(db, workScope, now);
    assert.ok(op);
    await settleWorkOperation(db, { id: op.id, token: op.claim_token }, { state: 'held' }, now);
    now = new Date(now.getTime() + 60_001);
    assert.equal((await recoverOneWorkOperation(db, { discord, notion }, context)).kind, 'paused');
    assert.equal((await readWorkOperation(db, workScope, op.id))?.state, 'held');
    db.raw
      .prepare('UPDATE discord_work_operations SET result_json=? WHERE id=?')
      .run(JSON.stringify({ forumId }), op.id);
    assert.equal(
      (
        JSON.parse((await readWorkOperation(db, workScope, op.id))?.result_json ?? '{}') as {
          forumId?: string;
        }
      ).forumId,
      forumId,
    );
    now = new Date(now.getTime() + 300_001);
    assert.equal((await recoverOneWorkOperation(db, { discord, notion }, context)).kind, 'paused');
    assert.equal((await readWorkOperation(db, workScope, op.id))?.state, 'held');
    proof = {
      forumId: '444444444444444445',
      threadId: '555555555555555555',
      starterMessageId: '555555555555555555',
    };
    now = new Date(now.getTime() + 300_001);
    assert.equal((await recoverOneWorkOperation(db, { discord, notion }, context)).kind, 'paused');
    assert.equal((await readWorkOperation(db, workScope, op.id))?.state, 'held');
    assert.equal(
      (
        JSON.parse((await readWorkOperation(db, workScope, op.id))?.result_json ?? '{}') as {
          forumId?: string;
        }
      ).forumId,
      forumId,
    );
    proof = { forumId, threadId: '555555555555555555', starterMessageId: '555555555555555555' };
    now = new Date(now.getTime() + 300_001);
    assert.equal(
      (await recoverOneWorkOperation(db, { discord, notion }, context)).kind,
      'progress',
    );
    assert.equal((await readWorkOperation(db, workScope, op.id))?.state, 'queued');
  } finally {
    db.raw.close();
  }
});

void test('creation recovery does not report progress if the held operation changed during discovery', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => workNow };
  try {
    await enqueueWorkOperation(
      db,
      {
        id: 'creation-race',
        scope: workScope,
        homeId: null,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'setup:creation-race',
        actorPersonId: 'guest',
        actorDiscordId: discordUserId,
        originalAuthorId: discordUserId,
        grantVersion: 'grant',
        payload: {
          intent: 'home',
          linkId: 'home',
          createForum: true,
          destinationId: '777777777777777777',
          subject: { kind: 'project_plan', sourceId: projectSourceId, pageId: projectId },
        },
      },
      workNow,
    );
    const op = await claimWorkOperation(db, workScope, workNow);
    assert.ok(op);
    await settleWorkOperation(db, { id: op.id, token: op.claim_token }, { state: 'held' }, workNow);
    Object.assign(discord, {
      discoverWork: () => {
        db.raw
          .prepare("UPDATE discord_work_operations SET state='confirmed' WHERE id=?")
          .run(op.id);
        return Promise.resolve({ forumId: '333333333333333333', threadId: '555555555555555555' });
      },
    });
    const later = { ...context, clock: () => new Date(workNow.getTime() + 60_001) };
    assert.deepEqual(await recoverOneWorkOperation(db, { discord, notion }, later), {
      kind: 'paused',
      reason: 'link_changed',
    });
    assert.equal((await readWorkOperation(db, workScope, op.id))?.state, 'confirmed');
  } finally {
    db.raw.close();
  }
});
