import assert from 'node:assert/strict';
import test from 'node:test';
import { workFixture, workScope, workNow, sourceId } from './support/discord-work';
import { DiscordWorkClient } from '../src/discord-work-provider';
import {
  saveProjectHome,
  saveWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  enqueueWorkOperation,
  claimWorkOperation,
  settleWorkOperation,
  readWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { projectId, projectSourceId, discordUserId } from './support/discord-work';
void test('disabled shared work invokes no providers and does not depend on personal check-ins', async () => {
  const module = await import('../src/discord-work-runner').catch(() => null);
  assert.ok(module, 'bounded work runner exists');
  const { db, notion } = workFixture();
  let calls = 0;
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
    fetch: () => {
      calls++;
      return Promise.reject(new Error('unexpected provider call'));
    },
  });
  try {
    const result = await module.runDiscordWorkBatch(
      db,
      { notion, discord },
      {
        scope: workScope,
        taskSourceId: sourceId,
        enabled: false,
        clock: () => workNow,
        stage: 'ingest',
        deadline: workNow.getTime() + 1000,
        maxLinks: 1,
        maxEffects: 1,
      },
    );
    assert.equal(result.kind, 'idle');
    assert.equal(calls, 0);
  } finally {
    db.raw.close();
  }
});

void test('scheduled refresh queues the existing project footer for authorized reconciliation', async () => {
  const { runDiscordWorkBatch } = await import('../src/discord-work-runner');
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
    id: 'overview',
    scope: workScope,
    subject: { kind: 'project_plan' as const, sourceId: projectSourceId, pageId: projectId },
    homeId: 'home',
    placementProjectId: projectId,
    threadId: '555555555555555555',
    starterMessageId: '555555555555555555',
    mode: 'selected' as const,
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
    await enqueueWorkOperation(
      db,
      {
        id: 'backlink',
        scope: workScope,
        homeId: 'home',
        conversationId: 'overview',
        generation: 1,
        kind: 'backlink',
        sourceKey: 'backlink:overview',
        actorPersonId: 'guest',
        actorDiscordId: discordUserId,
        originalAuthorId: discordUserId,
        grantVersion: 'grant',
        payload: {},
      },
      workNow,
    );
    const operation = await claimWorkOperation(db, workScope, workNow);
    assert.ok(operation);
    await settleWorkOperation(
      db,
      { id: operation.id, token: operation.claim_token },
      { state: 'confirmed' },
      workNow,
    );
    await enqueueWorkOperation(
      db,
      {
        id: 'other-backlink',
        scope: workScope,
        homeId: 'home',
        conversationId: 'overview',
        generation: 1,
        kind: 'backlink',
        sourceKey: 'other-backlink',
        actorPersonId: 'guest',
        actorDiscordId: discordUserId,
        originalAuthorId: discordUserId,
        grantVersion: 'grant',
        payload: {},
      },
      workNow,
    );
    const other = await claimWorkOperation(db, workScope, workNow);
    assert.ok(other);
    await settleWorkOperation(
      db,
      { id: other.id, token: other.claim_token },
      { state: 'confirmed' },
      workNow,
    );
    let now = new Date(workNow.getTime() + 60_001);
    const context = {
      scope: workScope,
      taskSourceId: sourceId,
      enabled: true,
      clock: () => now,
      stage: 'refresh' as const,
      deadline: now.getTime() + 300_000,
      maxLinks: 1,
      maxEffects: 1,
    };
    await runDiscordWorkBatch(db, { notion, discord }, context);
    assert.equal((await readWorkOperation(db, workScope, operation.id))?.state, 'queued');
    assert.equal((await readWorkOperation(db, workScope, other.id))?.state, 'confirmed');
    now = new Date(now.getTime() + 60_001);
    await runDiscordWorkBatch(db, { notion, discord }, context);
    assert.equal((await readWorkOperation(db, workScope, operation.id))?.state, 'queued');
    db.raw.prepare("UPDATE discord_work_operations SET state='held' WHERE id=?").run(operation.id);
    now = new Date(now.getTime() + 60_001);
    await runDiscordWorkBatch(db, { notion, discord }, context);
    assert.equal((await readWorkOperation(db, workScope, operation.id))?.state, 'held');
    assert.equal(
      db.raw
        .prepare("SELECT count(*) AS n FROM discord_work_operations WHERE kind='backlink'")
        .get()?.n,
      2,
    );
  } finally {
    db.raw.close();
  }
});
