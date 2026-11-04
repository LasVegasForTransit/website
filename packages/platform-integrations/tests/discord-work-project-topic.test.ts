import assert from 'node:assert/strict';
import test from 'node:test';
import { saveProjectHome } from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  claimWorkOperation,
  enqueueWorkOperation,
  settleWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { runWorkPreview } from '../src/discord-work-setup';
import { processWorkTopic } from '../src/discord-work-project-topic';
import { runDiscordWorkBatch } from '../src/discord-work-runner';
import { recoverOneWorkOperation } from '../src/discord-work-recovery';
import {
  discordUserId,
  projectId,
  projectSourceId,
  sourceId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

void test('an administrator reviews and queues a forum topic without overwriting later edits', async () => {
  const { db, notion } = workFixture();
  const forumId = '555555555555555555';
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  let topic: string | null = 'Original topic';
  let writes = 0;
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: () =>
      Promise.resolve({
        destination: { kind: 'forum', channelId: forumId, parentId: null },
        audienceFingerprint: 'audience',
        canRead: true,
        canManageChannels: true,
      }),
    readForumTopic: () => Promise.resolve(topic),
    updateForumTopic: (input: { expectedTopic: string | null; topic: string }) => {
      if (topic !== input.expectedTopic) return Promise.reject(new Error('forum_topic_changed'));
      topic = input.topic;
      writes++;
      return Promise.resolve();
    },
  });
  const base = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId: forumId,
    interactionId: '777777777777777777',
  };
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => workNow };
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    await saveProjectHome(
      db,
      {
        id: 'project',
        scope: workScope,
        projectSourceId,
        projectId,
        destination: { kind: 'forum', channelId: forumId, parentId: null },
        taskParent: null,
        audienceFingerprint: 'audience',
        approvedBy: 'guest',
        state: 'active',
        generation: 1,
      },
      0,
      workNow,
    );
    const preview = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'project-topic', destinationId: forumId } },
      context,
    );
    assert.match(JSON.stringify(preview), /Original topic/);
    assert.match(JSON.stringify(preview), /Replace/);
    assert.equal(writes, 0);
    const receipt = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='project-topic'",
      )
      .get();
    assert.ok(receipt);
    const confirmed = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'topic-confirm', linkId: String(receipt.id) } },
      context,
    );
    assert.match(JSON.stringify(confirmed), /queued/i);
    const op = await claimWorkOperation(db, workScope, workNow);
    assert.ok(op);
    topic = 'Organizer edited this';
    const result = await processWorkTopic(db, { notion, discord }, op, context);
    assert.equal(result.kind, 'paused');
    assert.equal(writes, 0);
    assert.equal(topic, 'Organizer edited this');
    const status = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'show' } },
      context,
    );
    assert.match(JSON.stringify(status), /forum topic changed after review/i);
    topic = 'Original topic';
    await runWorkPreview(
      db,
      { notion, discord },
      {
        ...base,
        interactionId: '777777777777777778',
        intent: { action: 'project-topic', destinationId: forumId },
      },
      context,
    );
    const second = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='project-topic' ORDER BY rowid DESC LIMIT 1",
      )
      .get();
    assert.ok(second);
    await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'topic-confirm', linkId: String(second.id) } },
      context,
    );
    const applied = await runDiscordWorkBatch(
      db,
      { notion, discord },
      {
        ...context,
        stage: 'effects',
        deadline: workNow.getTime() + 60000,
        maxLinks: 1,
        maxEffects: 1,
      },
    );
    assert.equal(applied.kind, 'progress');
    assert.equal(writes, 1);
    assert.equal(topic, `Project plan: https://www.notion.so/${projectId.replaceAll('-', '')}`);
    const afterSuccess = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'show' } },
      context,
    );
    assert.doesNotMatch(JSON.stringify(afterSuccess), /forum topic changed after review/i);
  } finally {
    db.raw.close();
  }
});

void test('a lost topic response is confirmed only when the requested topic is visible, without another write', async () => {
  const { db, notion } = workFixture();
  const forumId = '555555555555555555';
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  let topic = 'Organizer text',
    writes = 0;
  Object.assign(discord, {
    inspectDestination: () =>
      Promise.resolve({
        destination: { kind: 'forum', channelId: forumId, parentId: null },
        audienceFingerprint: 'audience',
        canRead: true,
      }),
    readForumTopic: () => Promise.resolve(topic),
    updateForumTopic: () => {
      writes++;
      return Promise.resolve();
    },
  });
  let current = new Date(workNow.getTime() + 120000);
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => current };
  const desired = `Project plan: https://www.notion.so/${projectId.replaceAll('-', '')}`;
  try {
    await saveProjectHome(
      db,
      {
        id: 'project',
        scope: workScope,
        projectSourceId,
        projectId,
        destination: { kind: 'forum', channelId: forumId, parentId: null },
        taskParent: null,
        audienceFingerprint: 'audience',
        approvedBy: 'guest',
        state: 'active',
        generation: 1,
      },
      0,
      workNow,
    );
    await enqueueWorkOperation(
      db,
      {
        id: 'topic',
        scope: workScope,
        homeId: 'project',
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'topic:test',
        actorPersonId: 'guest',
        actorDiscordId: discordUserId,
        grantVersion: 'grant',
        originalAuthorId: discordUserId,
        payload: {
          intent: 'project-topic',
          subject: { kind: 'project_plan', sourceId: projectSourceId, pageId: projectId },
          forumId,
          audienceFingerprint: 'audience',
          expectedTopic: 'Old topic',
          topic: desired,
        },
      },
      workNow,
    );
    const op = await claimWorkOperation(db, workScope, workNow);
    assert.ok(op);
    await settleWorkOperation(
      db,
      { id: op.id, token: op.claim_token },
      { state: 'held', reason: 'unconfirmed_effect' },
      workNow,
    );
    assert.equal((await recoverOneWorkOperation(db, { notion, discord }, context)).kind, 'paused');
    assert.equal(
      db.raw.prepare("SELECT state FROM discord_work_operations WHERE id='topic'").get()?.state,
      'held',
    );
    topic = desired;
    current = new Date(current.getTime() + 300001);
    assert.equal(
      (await recoverOneWorkOperation(db, { notion, discord }, context)).kind,
      'progress',
    );
    assert.equal(
      db.raw.prepare("SELECT state FROM discord_work_operations WHERE id='topic'").get()?.state,
      'confirmed',
    );
    assert.equal(writes, 0);
  } finally {
    db.raw.close();
  }
});
