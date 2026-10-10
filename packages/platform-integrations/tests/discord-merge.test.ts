import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from '../../platform-storage/tests/support/merge-fixture';
import { pendingDiscordOperations } from '@lasvegasfortransit/platform-storage/discord-pending';
import { operationIsCurrent } from '@lasvegasfortransit/platform-storage/outbox';
import { syncDiscordOperation } from '../src/discord-sync';
import { DiscordAccess } from '../src/discord-access';
const guildId = '111111111111111111',
  memberRoleId = '333333333333333333';
const identityId = '222222222222222222',
  committeeRoleId = '444444444444444444';
const unrelated = '555555555555555555';
void test('merge preserves the survivor account and undo invalidates delayed cleanup before withdrawal removes access', async () => {
  const f = await mergeFixture();
  await f.people.linkIdentity(f.merged.id, {
    platform: 'discord',
    externalId: identityId,
    linkMethod: 'self_linked',
  });
  await f.db
    .prepare("UPDATE committees SET discord_role_id=? WHERE id='events'")
    .bind(committeeRoleId)
    .run();
  assert.equal(
    (
      await f.committees.assign({
        personId: f.merged.id,
        committeeId: 'events',
        role: 'member',
        actorId: f.actor.personId,
        operationId: 'discord-assign',
      })
    ).kind,
    'ok',
  );
  const merged = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(merged.kind, 'ok');
  assert.equal(
    (
      await f.db
        .prepare(
          "SELECT count(*) AS n FROM integration_outbox WHERE json_extract(payload,'$.source')='person_deleted'",
        )
        .first()
    )?.n,
    0,
    'merge owns its cleanup; it must not enqueue ordinary deletion',
  );
  const oldJob = await f.db
    .prepare(
      "SELECT id FROM integration_outbox WHERE person_id=? AND kind='person_reconcile' AND state='queued'",
    )
    .bind(f.merged.id)
    .first<{ id: string }>();
  assert.ok(oldJob);
  const roles = new Set([memberRoleId, committeeRoleId, unrelated]);
  const writes: string[] = [];
  const client = new DiscordAccess(
    {
      environment: 'preview',
      guildId,
      productionGuildId: '999999999999999999',
      botToken: 'fixture-only',
    },
    {
      fetch: (url, init) => {
        const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        const role = new URL(address).pathname.split('/').at(-1);
        assert.ok(role);
        if (init?.method === 'DELETE') {
          writes.push(role);
          roles.delete(role);
        }
        if (init?.method === 'PUT') {
          writes.push(role);
          roles.add(role);
        }
        return Promise.resolve(
          init?.method === 'GET'
            ? Response.json({
                user: {
                  id: identityId,
                  username: 'fixture.account',
                  global_name: null,
                  avatar: null,
                },
                roles: [...roles],
                pending: false,
                nick: null,
              })
            : new Response(null, { status: 204 }),
        );
      },
    },
  );
  assert.deepEqual(await syncDiscordOperation(f.db, oldJob.id, { client, memberRoleId }), {
    kind: 'not_ready',
  });
  const [survivorJob] = await pendingDiscordOperations(f.db, new Date(), 25);
  assert.ok(survivorJob);
  assert.equal(
    (await syncDiscordOperation(f.db, survivorJob, { client, memberRoleId })).kind,
    'confirmed',
  );
  assert.equal(writes.length, 0);
  const undone = await f.undoMerge(f.db, f.actor, {
    mergeId: merged.value.mergeId,
    reason: 'Member clarified the entries.',
    operationId: 'discord-undo',
  });
  assert.equal(undone.kind, 'ok');
  assert.equal(await operationIsCurrent(f.db, oldJob.id), false);
  assert.deepEqual(await syncDiscordOperation(f.db, oldJob.id, { client, memberRoleId }), {
    kind: 'stale',
  });
  assert.deepEqual(await syncDiscordOperation(f.db, survivorJob, { client, memberRoleId }), {
    kind: 'stale',
  });
  const [restoredJob] = await pendingDiscordOperations(f.db, new Date(), 25);
  assert.ok(restoredJob);
  assert.equal(
    (await syncDiscordOperation(f.db, restoredJob, { client, memberRoleId })).kind,
    'confirmed',
  );
  assert.equal(writes.length, 0);
  await f.people.withdrawConsent(f.merged.id, {
    scope: 'newsletter',
    source: 'member',
    withdrawnAt: new Date().toISOString(),
  });
  const [removal] = await pendingDiscordOperations(f.db, new Date(), 25);
  assert.ok(removal);
  assert.equal(
    (await syncDiscordOperation(f.db, removal, { client, memberRoleId })).kind,
    'confirmed',
  );
  assert.deepEqual([...roles], [unrelated]);
  f.db.raw.close();
});
