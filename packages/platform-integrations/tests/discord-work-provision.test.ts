import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enqueueWorkOperation,
  claimWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import {
  listProjectHomes,
  listWorkConversations,
  unlinkWork,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { resolveWorkActor } from '../src/discord-work-authority';
import { DiscordWorkClient } from '../src/discord-work-provider';
import {
  workFixture,
  workScope,
  workNow,
  sourceId,
  projectId,
  projectSourceId,
  discordUserId,
} from './support/discord-work';
void test('adopting a forum creates one project overview and durable reciprocal-link work', async () => {
  const module = await import('../src/discord-work-provision').catch(() => null);
  assert.ok(module, 'durable provisioning exists');
  const { db, notion } = workFixture();
  let creates = 0;
  db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
  db.raw
    .prepare(
      "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
    )
    .run(workNow.toISOString());
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  const destination = {
    destination: { kind: 'forum' as const, channelId: '333333333333333333', parentId: null },
    audienceFingerprint: 'audience',
    archived: false,
    locked: false,
    canRead: true,
    canSend: true,
    canCreateThreads: true,
    canManageChannels: true,
    requiredTag: false,
    tags: [],
  };
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: () => Promise.resolve(destination),
    createTaskConversation: () => {
      creates++;
      return Promise.resolve({
        threadId: '555555555555555555',
        starterMessageId: '555555555555555555',
      });
    },
  });
  try {
    const actor = await resolveWorkActor(db, workScope, discordUserId);
    assert.ok(actor);
    await enqueueWorkOperation(
      db,
      {
        id: 'provision',
        scope: workScope,
        homeId: null,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'setup:one',
        actorPersonId: actor.personId,
        actorDiscordId: discordUserId,
        grantVersion: actor.grantVersion,
        originalAuthorId: discordUserId,
        payload: {
          intent: 'home',
          linkId: 'home',
          subject: { kind: 'project_plan', sourceId: projectSourceId, pageId: projectId },
          title: 'Project',
          destinationId: destination.destination.channelId,
          audienceFingerprint: 'audience',
          createForum: false,
          tagIds: [],
        },
      },
      workNow,
    );
    const op = await claimWorkOperation(db, workScope, workNow);
    assert.ok(op);
    const result = await module.processWorkProvision(db, { notion, discord }, op, {
      scope: workScope,
      taskSourceId: sourceId,
      enabled: true,
      clock: () => workNow,
    });
    assert.equal(result.kind, 'progress');
    assert.equal(creates, 1);
    assert.equal((await listProjectHomes(db, workScope)).length, 1);
    assert.equal((await listWorkConversations(db, workScope)).length, 1);
    // A recovered old receipt cannot create another overview after the administrator unlinks it.
    await unlinkWork(db, { scope: workScope, id: 'home', generation: 1 }, workNow);
    await enqueueWorkOperation(
      db,
      {
        id: 'old-receipt',
        scope: workScope,
        homeId: null,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'setup:old',
        actorPersonId: actor.personId,
        actorDiscordId: discordUserId,
        grantVersion: actor.grantVersion,
        originalAuthorId: discordUserId,
        payload: JSON.parse(op.payload_json) as Record<string, unknown>,
      },
      workNow,
    );
    const old = await claimWorkOperation(db, workScope, workNow);
    assert.ok(old);
    await module.processWorkProvision(db, { notion, discord }, old, {
      scope: workScope,
      taskSourceId: sourceId,
      enabled: true,
      clock: () => workNow,
    });
    assert.equal(creates, 1);
    assert.equal(
      db.raw
        .prepare("SELECT count(*) AS n FROM discord_work_operations WHERE kind='backlink'")
        .get()?.n,
      1,
    );
  } finally {
    db.raw.close();
  }
});
