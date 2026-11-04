import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enqueueWorkOperation,
  claimWorkOperation,
  readWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { resolveWorkActor } from '../src/discord-work-authority';
import { processWorkDestination } from '../src/discord-work-destination';
import { recoverOneWorkOperation } from '../src/discord-work-recovery';
import { discordUserId, sourceId, workFixture, workNow, workScope } from './support/discord-work';

void test('uncertain category creation resumes only after a matching audit result', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  let found: string | null = null,
    writes = 0;
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectGuildPlacement: () =>
      Promise.resolve({ canManageChannels: true, audienceFingerprint: 'approved' }),
    findCreatedCategory: () => Promise.resolve(found),
    createRouteDestination: () => {
      writes++;
      return Promise.reject(new Error('lost response'));
    },
  });
  let now = workNow;
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => now };
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
        id: 'category',
        scope: workScope,
        homeId: null,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'category',
        actorPersonId: actor.personId,
        actorDiscordId: discordUserId,
        originalAuthorId: discordUserId,
        grantVersion: actor.grantVersion,
        payload: {
          intent: 'destination',
          kind: 'category',
          name: 'Projects',
          audienceFingerprint: 'approved',
        },
      },
      now,
    );
    const first = await claimWorkOperation(db, workScope, now);
    assert.ok(first);
    assert.equal(
      (await processWorkDestination(db, { discord, notion }, first, context)).kind,
      'paused',
    );
    now = new Date(now.getTime() + 60_001);
    assert.equal((await recoverOneWorkOperation(db, { discord, notion }, context)).kind, 'paused');
    found = '555555555555555555';
    now = new Date(now.getTime() + 300_001);
    assert.equal(
      (await recoverOneWorkOperation(db, { discord, notion }, context)).kind,
      'progress',
    );
    const resumed = await claimWorkOperation(db, workScope, now);
    assert.ok(resumed);
    assert.equal(
      (await processWorkDestination(db, { discord, notion }, resumed, context)).kind,
      'progress',
    );
    assert.equal((await readWorkOperation(db, workScope, first.id))?.state, 'confirmed');
    assert.equal(writes, 1);
  } finally {
    db.raw.close();
  }
});

for (const outcome of ['success', 'changed', 'uncertain'] as const) {
  void test(`destination creation handles ${outcome}`, async () => {
    const { db, notion } = workFixture();
    const discord = new DiscordWorkClient({
      guildId: workScope.guildId,
      applicationId: '444444444444444444',
      botToken: 'fixture-only',
    });
    let writes = 0;
    let found: string | null = null;
    Object.assign(discord, {
      membership: () => Promise.resolve(true),
      findRouteDestination: () => Promise.resolve(found),
      inspectDestination: () =>
        Promise.resolve({
          isCategory: true,
          canRead: true,
          canManageChannels: true,
          audienceFingerprint: outcome === 'changed' ? 'changed' : 'approved',
        }),
      createRouteDestination: () => {
        writes++;
        return outcome === 'uncertain'
          ? Promise.reject(new Error('lost response'))
          : Promise.resolve({ channelId: '555555555555555555', parentId: '333333333333333333' });
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
          id: 'destination',
          scope: workScope,
          homeId: null,
          conversationId: null,
          generation: 1,
          kind: 'provision',
          sourceKey: 'destination',
          actorPersonId: actor.personId,
          actorDiscordId: discordUserId,
          originalAuthorId: discordUserId,
          grantVersion: actor.grantVersion,
          payload: {
            intent: 'destination',
            kind: 'forum',
            name: 'Events',
            parentId: '333333333333333333',
            audienceFingerprint: 'approved',
          },
        },
        workNow,
      );
      const op = await claimWorkOperation(db, workScope, workNow);
      assert.ok(op);
      await processWorkDestination(db, { discord, notion }, op, {
        scope: workScope,
        taskSourceId: sourceId,
        enabled: true,
        clock: () => workNow,
      });
      const saved = await readWorkOperation(db, workScope, op.id);
      assert.equal(
        saved?.state,
        outcome === 'success' ? 'confirmed' : outcome === 'changed' ? 'failed' : 'held',
      );
      assert.equal(writes, outcome === 'changed' ? 0 : 1);
      if (outcome === 'success')
        assert.equal(
          (JSON.parse(saved.result_json ?? '{}') as { channelId?: string }).channelId,
          '555555555555555555',
        );
      if (outcome === 'uncertain') {
        let later = new Date(workNow.getTime() + 60_001);
        const context = {
          scope: workScope,
          taskSourceId: sourceId,
          enabled: true,
          clock: () => later,
        };
        assert.equal(
          (await recoverOneWorkOperation(db, { discord, notion }, context)).kind,
          'paused',
        );
        found = '555555555555555555';
        later = new Date(later.getTime() + 300_001);
        assert.equal(
          (await recoverOneWorkOperation(db, { discord, notion }, context)).kind,
          'progress',
        );
        const resumed = await claimWorkOperation(db, workScope, later);
        assert.ok(resumed);
        assert.equal(
          (await processWorkDestination(db, { discord, notion }, resumed, context)).kind,
          'progress',
        );
        assert.equal((await readWorkOperation(db, workScope, op.id))?.state, 'confirmed');
        assert.equal(writes, 1, 'recovery never sends a second creation request');
      }
    } finally {
      db.raw.close();
    }
  });
}
