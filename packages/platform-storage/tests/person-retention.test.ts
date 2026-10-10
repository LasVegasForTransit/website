import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '../src/person-service';
import { runMaintenance } from '../src/retention';
import { loadDiscordPlan } from '../src/discord-plan';
import { operationIsCurrent } from '../src/outbox';
import { claimDiscordLease, saveDiscordSync } from '../src/discord-sync-store';
import { prepareDiscordChange, confirmDiscordChanges } from '../src/discord-change-audit';
import { memoryDb, type MemoryDb } from './support/db';
import { mergeFixture } from './support/merge-fixture';
const now = new Date('2026-10-09T12:00:00.000Z');
async function deleted(db: MemoryDb, id: string, at: string) {
  db.raw
    .prepare(
      "INSERT INTO people(id,given_name,email,created_at,updated_at) VALUES(?,? ,?,'2026-01-01','2026-01-01')",
    )
    .run(id, 'Private name', `${id}@example.invalid`);
  db.raw.prepare('UPDATE people SET deleted_at=? WHERE id=?').run(at, id);
  await new PersonService(db).deletePerson(id);
}
void test('maintenance physically removes profiles strictly older than 30 days in bounded repeatable batches', async () => {
  const db = memoryDb();
  await deleted(db, 'before-one', '2026-09-09T11:59:59.998Z');
  await deleted(db, 'before-two', '2026-09-09T11:59:59.999Z');
  await deleted(db, 'at', '2026-09-09T12:00:00.000Z');
  await deleted(db, 'after', '2026-09-09T12:00:00.001Z');
  await runMaintenance(db, { now, limit: 1 });
  assert.equal(
    db.raw.prepare("SELECT count(*) AS n FROM people WHERE id LIKE 'before-%'").get()?.n,
    1,
  );
  await runMaintenance(db, { now, limit: 1 });
  await runMaintenance(db, { now, limit: 1 });
  assert.deepEqual(
    db.raw
      .prepare('SELECT id FROM people ORDER BY id')
      .all()
      .map((r) => r.id),
    ['after', 'at'],
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM person_retention_scope').get()?.n, 0);
  assert.deepEqual(db.raw.prepare('PRAGMA foreign_key_check').all(), []);
  db.raw.close();
});
void test('purging a profile preserves queued Discord removal, read-backed audit and no external profile data', async () => {
  const db = memoryDb();
  db.raw.exec(
    "INSERT INTO people(id,created_at,updated_at) VALUES('person','2026-01-01','2026-01-01')",
  );
  await new PersonService(db).linkIdentity('person', {
    platform: 'discord',
    externalId: '222222222222222222',
    externalEmail: 'private@example.invalid',
    linkMethod: 'self_linked',
  });
  db.raw.exec("UPDATE people SET deleted_at='2026-09-01T12:00:00.000Z' WHERE id='person'");
  await new PersonService(db).deletePerson('person');
  const operationId = String(
    db.raw
      .prepare("SELECT id FROM integration_outbox WHERE person_id='person' AND state='queued'")
      .get()?.id,
  );
  const input = {
    personId: 'person',
    guildId: '111111111111111111',
    memberRoleId: '333333333333333333',
    operationId,
  };
  const before = await loadDiscordPlan(db, input);
  assert.ok(before);
  const lease = await claimDiscordLease(db, before, now);
  assert.ok(lease);
  const member = {
    user: { id: before.identityId, username: 'private', displayName: null, avatar: null },
    roles: ['333333333333333333', '444444444444444444'],
    pending: false,
    nickname: null,
  };
  assert.equal(
    await prepareDiscordChange(
      db,
      { plan: before, operationId, lease, now, member },
      { resourceId: input.memberRoleId, wasGranted: true },
    ),
    true,
  );
  await runMaintenance(db, { now });
  assert.equal(db.raw.prepare("SELECT id FROM people WHERE id='person'").get(), undefined);
  assert.equal(await operationIsCurrent(db, operationId), true);
  const plan = await loadDiscordPlan(db, input);
  assert.ok(plan);
  assert.deepEqual(plan.desiredRoleIds, []);
  assert.equal(
    plan.revision,
    before.revision,
    'physical cleanup must not invalidate an interrupted removal intent',
  );
  const write = {
    plan,
    operationId,
    lease,
    now,
    member: { ...member, roles: ['444444444444444444'] },
  };
  await confirmDiscordChanges(db, write);
  assert.equal(await saveDiscordSync(db, write), true);
  assert.equal(
    db.raw.prepare("SELECT action FROM staff_audits WHERE actor_id='platform:discord'").get()
      ?.action,
    'access.revoked',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM provider_access_intents').get()?.n, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM discord_profiles').get()?.n, 0);
  assert.equal(db.raw.prepare('SELECT external_email FROM identities').get()?.external_email, null);
  db.raw.close();
});
void test('legacy ordinary deletions are erased before purge while active merge archives remain reversible', async () => {
  const f = await mergeFixture();
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  f.db.raw.exec(
    "INSERT INTO people(id,given_name,email,created_at,updated_at,deleted_at) VALUES('legacy','Legacy private','legacy@example.invalid','2020-01-01','2020-01-01','2020-01-01')",
  );
  await runMaintenance(f.db, { now: new Date('2030-10-09T12:00:00.000Z') });
  assert.equal(f.db.raw.prepare("SELECT id FROM people WHERE id='legacy'").get(), undefined);
  assert.equal(
    f.db.raw.prepare('SELECT phone FROM people WHERE id=?').get(f.merged.id)?.phone,
    '+17025550100',
  );
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: combined.value.mergeId,
        reason: 'Separate people',
        operationId: 'undo-after-retention',
      })
    ).kind,
    'ok',
  );
  assert.equal((await f.people.getPerson(f.merged.id))?.phone, '+17025550100');
  f.db.raw.close();
});
void test('purge keeps another person’s withdrawal evidence and actor attribution without retaining the deleted profile', async () => {
  const f = await mergeFixture();
  f.db.raw
    .prepare(
      "INSERT INTO consent_withdrawals VALUES('retained-evidence',?,?,'newsletter','account','2026-09-01','2026-09-01')",
    )
    .run(f.survivor.id, f.merged.id);
  f.db.raw
    .prepare(
      "INSERT INTO committee_assignments(id,person_id,committee_id,role,started_at,assigned_by,updated_at) VALUES('attributed',?,'events','member','2026-01-01',?,'2026-01-01')",
    )
    .run(f.survivor.id, f.merged.id);
  await f.people.deletePerson(f.merged.id);
  await runMaintenance(f.db, { now: new Date('2030-10-09T12:00:00.000Z') });
  assert.equal(f.db.raw.prepare('SELECT id FROM people WHERE id=?').get(f.merged.id), undefined);
  assert.equal(
    f.db.raw
      .prepare("SELECT origin_person_id FROM consent_withdrawals WHERE id='retained-evidence'")
      .get()?.origin_person_id,
    f.merged.id,
  );
  assert.equal(
    f.db.raw.prepare("SELECT assigned_by FROM committee_assignments WHERE id='attributed'").get()
      ?.assigned_by,
    f.merged.id,
  );
  assert.equal((await f.people.getPerson(f.survivor.id))?.given_name, 'Survivor');
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM consent_records WHERE person_id=?').get(f.merged.id)
      ?.n,
    0,
  );
  assert.deepEqual(f.db.raw.prepare('PRAGMA foreign_key_check').all(), []);
  f.db.raw.close();
});
void test('retention rollback restores profiles and queued work and leaves no deletion scope', async () => {
  const db = memoryDb();
  await deleted(db, 'expired', '2026-09-01T00:00:00.000Z');
  const before = db.raw.prepare('SELECT * FROM people').all();
  db.raw.exec(
    "CREATE TRIGGER fail_profile_retention BEFORE DELETE ON person_retention_scope BEGIN SELECT RAISE(ABORT,'fixture rollback'); END",
  );
  await assert.rejects(runMaintenance(db, { now }), /fixture rollback/);
  assert.deepEqual(db.raw.prepare('SELECT * FROM people').all(), before);
  for (const table of [
    'person_retention_scope',
    'person_erasure_scope',
    'person_erasure_copies',
    'audit_retention_scope',
  ])
    assert.equal(db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
  assert.throws(() => db.raw.exec('DELETE FROM people'), /retention/);
  db.raw.exec('DROP TRIGGER fail_profile_retention');
  await runMaintenance(db, { now });
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
  assert.throws(
    () =>
      db.raw.exec(
        "INSERT INTO people(id,created_at,updated_at) VALUES('expired','2026-10-09','2026-10-09')",
      ),
    /recreated/,
  );
  assert.throws(() => db.raw.exec('UPDATE person_keys SET erased_at=NULL'), /restored/);
  assert.throws(() => db.raw.exec('DELETE FROM person_keys'), /erased/);
  assert.throws(
    () => db.raw.exec("INSERT OR REPLACE INTO person_keys(id) VALUES('expired')"),
    /erased/,
  );
  db.raw.close();
});
