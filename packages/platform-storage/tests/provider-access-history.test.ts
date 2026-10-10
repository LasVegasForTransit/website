import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import { accessHistory } from '../src/access-history';
import { loadActor } from '../src/staff-roles';
import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
void test('confirmed provider history shows automatic attribution and the requester within current committee scope', async () => {
  const f = await mergeFixture();
  const lead = await f.create('lead@example.invalid', 'Lead');
  for (const [personId, role] of [
    [lead.id, 'lead'],
    [f.survivor.id, 'member'],
  ] as const)
    assert.equal(
      (
        await f.committees.assign({
          personId,
          role,
          committeeId: 'events',
          actorId: f.admin.id,
          operationId: personId,
        })
      ).kind,
      'ok',
    );
  const actor = await loadActor(f.db, lead.id);
  assert.ok(actor);
  for (const [id, targetId] of [
    ['confirmed', 'events'],
    ['outside', 'advocacy'],
    ['membership', 'person'],
  ] as const)
    await f.db
      .prepare(
        "INSERT INTO staff_audits(id,actor_id,action,target_id,details,occurred_at) VALUES(?,'platform:discord','access.granted',?,?,?)",
      )
      .bind(
        id,
        f.survivor.id,
        JSON.stringify({
          provider: 'discord',
          targetId,
          source: 'committee.assign',
          requestedBy: f.admin.id,
        }),
        new Date().toISOString(),
      )
      .run();
  await f.db
    .prepare(
      "INSERT INTO staff_audits(id,actor_id,action,target_id,details,occurred_at) VALUES('expired','platform:discord','access.granted',?,?,'2022-01-01T00:00:00.000Z')",
    )
    .bind(f.survivor.id, JSON.stringify({ provider: 'discord', targetId: 'events' }))
    .run();
  const scoped = (await accessHistory(f.db, actor, { personId: f.survivor.id })).items;
  const confirmed = scoped.find((row) => row.id === 'confirmed');
  assert.ok(confirmed, 'leads need their own committee’s confirmed access history');
  assert.equal(confirmed.actorName, 'Automatic Discord update');
  assert.equal(confirmed.requestedByName, 'Administrator');
  assert.equal(confirmed.source, 'committee.assign');
  assert.equal(confirmed.provider, 'discord');
  assert.equal(
    scoped.some((row) => ['outside', 'membership'].includes(row.id)),
    false,
  );
  const all = (await accessHistory(f.db, f.actor, { personId: f.survivor.id })).items;
  assert.equal(all.filter((row) => row.action === 'access.granted').length, 3);
  await assert.rejects(
    accessHistory(f.db, actor, { personId: f.survivor.id, administratorsOnly: true }),
    PermissionDenied,
  );
  assert.equal(
    all.some((row) => row.id === 'expired'),
    false,
  );
  f.db.raw.close();
});
void test('administrators retain anonymized deletion cleanup evidence; leads cannot see the erased record', async () => {
  const f = await mergeFixture();
  const lead = await f.create('lead@example.invalid', 'Lead');
  assert.equal(
    (
      await f.committees.assign({
        personId: lead.id,
        role: 'lead',
        committeeId: 'events',
        actorId: f.admin.id,
        operationId: 'lead',
      })
    ).kind,
    'ok',
  );
  assert.equal(
    (
      await f.committees.assign({
        personId: f.survivor.id,
        role: 'member',
        committeeId: 'events',
        actorId: f.admin.id,
        operationId: 'member',
      })
    ).kind,
    'ok',
  );
  const actor = await loadActor(f.db, lead.id);
  assert.ok(actor);
  await f.people.deletePerson(f.survivor.id);
  await f.db
    .prepare(
      "INSERT INTO staff_audits(id,actor_id,action,target_id,details,occurred_at) VALUES('deleted-confirmation','platform:discord','access.revoked',?,?,?)",
    )
    .bind(
      f.survivor.id,
      JSON.stringify({ provider: 'discord', targetId: 'events', source: 'person_deleted' }),
      new Date().toISOString(),
    )
    .run();
  const history = await accessHistory(f.db, f.actor);
  const cleanup = history.items.find((row) => row.id === 'deleted-confirmation');
  assert.ok(cleanup, 'an administrator needs retained cleanup evidence after deletion');
  assert.equal(cleanup.personName, 'Deleted record');
  assert.deepEqual((await accessHistory(f.db, actor, { personId: f.survivor.id })).items, []);
  f.db.raw.close();
});
