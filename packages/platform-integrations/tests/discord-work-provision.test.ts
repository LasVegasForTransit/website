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
import { runQueuedProjectPins } from './support/discord-work-pins';
import {
  workFixture,
  workScope,
  workNow,
  sourceId,
  projectId,
  projectSourceId,
  discordUserId,
} from './support/discord-work';
for (const mismatch of ['audience', 'category'] as const) {
  void test(`new project forum stops before the overview when its ${mismatch} differs`, async () => {
    const { processWorkProvision } = await import('../src/discord-work-provision');
    const { db, notion } = workFixture();
    const discord = new DiscordWorkClient({
      guildId: workScope.guildId,
      applicationId: '444444444444444444',
      botToken: 'fixture-only',
    });
    const categoryId = '333333333333333333',
      forumId = '666666666666666666';
    let creates = 0,
      posts = 0;
    Object.assign(discord, {
      membership: () => Promise.resolve(true),
      inspectDestination: (id: string) =>
        Promise.resolve({
          isCategory: id === categoryId,
          destination: {
            kind: 'forum',
            channelId: id,
            parentId:
              id === categoryId
                ? null
                : mismatch === 'category'
                  ? '777777777777777777'
                  : categoryId,
          },
          audienceFingerprint: id === forumId && mismatch === 'audience' ? 'changed' : 'approved',
          canRead: true,
          canSend: true,
          canManageChannels: true,
          canCreateThreads: true,
          archived: false,
          locked: false,
          requiredTag: false,
          tags: [],
        }),
      createProjectForum: () => {
        creates++;
        return Promise.resolve({ channelId: forumId });
      },
      createTaskConversation: () => {
        posts++;
        throw new Error('unexpected post');
      },
    });
    try {
      db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
      db.raw
        .prepare(
          "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
        )
        .run(workNow.toISOString());
      const actor = await resolveWorkActor(db, workScope, discordUserId);
      assert.ok(actor);
      await enqueueWorkOperation(
        db,
        {
          id: 'create',
          scope: workScope,
          homeId: null,
          conversationId: null,
          generation: 1,
          kind: 'provision',
          sourceKey: 'create',
          actorPersonId: actor.personId,
          actorDiscordId: discordUserId,
          grantVersion: actor.grantVersion,
          originalAuthorId: discordUserId,
          payload: {
            intent: 'home',
            linkId: 'home',
            subject: { kind: 'project_plan', sourceId: projectSourceId, pageId: projectId },
            title: 'Project',
            destinationId: categoryId,
            audienceFingerprint: 'approved',
            createForum: true,
            tagIds: [],
          },
        },
        workNow,
      );
      const op = await claimWorkOperation(db, workScope, workNow);
      assert.ok(op);
      const result = await processWorkProvision(db, { notion, discord }, op, {
        scope: workScope,
        taskSourceId: sourceId,
        enabled: true,
        clock: () => workNow,
      });
      assert.equal(result.kind, 'paused');
      assert.equal(result.reason, 'audience_changed');
      assert.equal(creates, 1);
      assert.equal(posts, 0);
      assert.equal((await listProjectHomes(db, workScope)).length, 0);
      assert.equal(
        db.raw
          .prepare(
            "SELECT json_extract(result_json,'$.forumId') AS id FROM discord_work_operations WHERE id='create'",
          )
          .get()?.id,
        forumId,
      );
    } finally {
      db.raw.close();
    }
  });
}
for (const pinFails of [false, true]) {
  void test(`adopting a forum retains its overview when pinning ${pinFails ? 'fails' : 'succeeds'}`, async () => {
    const module = await import('../src/discord-work-provision').catch(() => null);
    assert.ok(module, 'durable provisioning exists');
    const { db, notion } = workFixture();
    let creates = 0;
    const pins: string[][] = [];
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
      pinWorkMessage: (channelId: string, messageId: string) => {
        pins.push([channelId, messageId]);
        return pinFails ? Promise.reject(new Error('permission denied')) : Promise.resolve();
      },
      pinForumPost: () =>
        pinFails ? Promise.reject(new Error('permission denied')) : Promise.resolve(),
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
      const pinContext = {
        scope: workScope,
        taskSourceId: sourceId,
        enabled: true,
        clock: () => workNow,
      };
      assert.equal(
        (await runQueuedProjectPins(db, { notion, discord }, pinContext)).kind,
        'progress',
      );
      const homes = await listProjectHomes(db, workScope);
      assert.equal(homes.length, 1);
      assert.deepEqual(pins, [['555555555555555555', '555555555555555555']]);
      assert.equal(homes[0]?.overviewPin, pinFails ? 'needs_attention' : 'pinned');
      assert.equal(
        homes[0].overviewPostPin,
        undefined,
        'adopting a forum preserves its existing pinned post',
      );
      assert.equal((await listWorkConversations(db, workScope)).length, 1);
      if (!pinFails) {
        // Resume after the overview was saved but before its pin result was recorded.
        db.raw
          .prepare(
            "UPDATE discord_project_homes SET data_json=json_remove(data_json,'$.overviewPin','$.summaryMessageId','$.summaryChannelId') WHERE id='home'",
          )
          .run();
        db.raw
          .prepare(
            "UPDATE discord_work_operations SET state='processing',claim_token=?,lease_expires_at=? WHERE id='provision'",
          )
          .run(op.claim_token, new Date(workNow.getTime() + 60_000).toISOString());
        const resumed = await module.processWorkProvision(db, { notion, discord }, op, {
          scope: workScope,
          taskSourceId: sourceId,
          enabled: true,
          clock: () => workNow,
        });
        assert.equal(resumed.kind, 'progress');
        assert.equal(creates, 1);
        db.raw
          .prepare(
            "UPDATE discord_work_operations SET state='queued' WHERE json_extract(payload_json,'$.intent')='project-pins'",
          )
          .run();
        assert.equal(
          (await runQueuedProjectPins(db, { notion, discord }, pinContext)).kind,
          'progress',
        );
        assert.equal(pins.length, 2);
        assert.equal((await listProjectHomes(db, workScope))[0]?.overviewPin, 'pinned');
        assert.equal(
          (await listProjectHomes(db, workScope))[0]?.summaryMessageId,
          '555555555555555555',
        );
      }
      if (!pinFails) {
        db.raw
          .prepare(
            "UPDATE discord_project_homes SET data_json=json_remove(data_json,'$.overviewPin') WHERE id='home'",
          )
          .run();
        db.raw
          .prepare(
            "UPDATE discord_work_operations SET state='processing',claim_token=?,lease_expires_at=? WHERE id='provision'",
          )
          .run(op.claim_token, new Date(workNow.getTime() + 60_000).toISOString());
        Object.assign(discord, {
          pinWorkMessage: () => {
            db.raw
              .prepare(
                "UPDATE discord_work_operations SET state='held',claim_token=NULL WHERE json_extract(payload_json,'$.intent')='project-pins'",
              )
              .run();
            return Promise.resolve();
          },
        });
        db.raw
          .prepare(
            "UPDATE discord_work_operations SET state='queued' WHERE json_extract(payload_json,'$.intent')='project-pins'",
          )
          .run();
        assert.deepEqual(await runQueuedProjectPins(db, { notion, discord }, pinContext), {
          kind: 'paused',
          reason: 'unconfirmed_effect',
        });
        assert.equal((await listProjectHomes(db, workScope))[0]?.overviewPin, undefined);
      }
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
}
