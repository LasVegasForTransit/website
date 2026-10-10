import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb, type MemoryDb } from './support/db';
const now = new Date('2026-10-04T12:00:00.000Z');
function audit(db: MemoryDb, id: string, occurredAt: string) {
  db.raw
    .prepare(
      "INSERT INTO staff_audits(id,actor_id,action,occurred_at) VALUES(?,'platform:discord','access.granted',?)",
    )
    .run(id, occurredAt);
}
function view(db: MemoryDb, id: string, occurredAt: string) {
  db.raw
    .prepare(
      "INSERT INTO person_views(id,actor_id,person_id,occurred_at) VALUES(?,'staff','person',?)",
    )
    .run(id, occurredAt);
}
function count(db: MemoryDb, table: string): number {
  return Number(db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
}
void test('access history cannot be changed or deleted outside maintenance, including old entries', () => {
  const db = memoryDb();
  audit(db, 'old', '2020-01-01T00:00:00.000Z');
  assert.throws(
    () => db.raw.exec("UPDATE staff_audits SET action='access.revoked'"),
    /cannot be changed/,
  );
  assert.throws(() => db.raw.exec('DELETE FROM staff_audits'), /retention/);
  assert.equal(count(db, 'staff_audits'), 1);
  view(db, 'old-view', '2020-01-01T00:00:00.000Z');
  assert.throws(() => db.raw.exec('DELETE FROM person_views'), /retention/);
  assert.throws(
    () => db.raw.exec("UPDATE person_views SET person_id='another'"),
    /cannot be changed/,
  );
  db.raw.close();
});
void test('bounded maintenance preserves exact year cutoffs, expires claims at their deadline and repeats safely', async () => {
  const { runMaintenance } = await import('../src/retention');
  const db = memoryDb();
  audit(db, 'before', '2023-10-04T11:59:59.999Z');
  audit(db, 'at', '2023-10-04T12:00:00.000Z');
  audit(db, 'after', '2023-10-04T12:00:00.001Z');
  view(db, 'before', '2025-10-04T11:59:59.999Z');
  view(db, 'at', '2025-10-04T12:00:00.000Z');
  view(db, 'after', '2025-10-04T12:00:00.001Z');
  db.raw
    .prepare("INSERT INTO people(id,created_at,updated_at) VALUES('staff',?,?)")
    .run(now.toISOString(), now.toISOString());
  for (const [id, deadline] of [
    ['before', '2026-10-04T11:59:59.999Z'],
    ['at', now.toISOString()],
    ['after', '2026-10-04T12:00:00.001Z'],
  ] as const) {
    db.raw
      .prepare('INSERT INTO people(id,created_at,updated_at) VALUES(?,?,?)')
      .run(id, now.toISOString(), now.toISOString());
    db.raw
      .prepare(
        "INSERT INTO welcome_claims(id,person_id,actor_id,claimed_at,expires_at) VALUES(?,?,'staff',?,?)",
      )
      .run(id, id, '2026-10-01T00:00:00.000Z', deadline);
  }
  assert.deepEqual(await runMaintenance(db, { now, limit: 1 }), {
    viewsRemoved: 1,
    auditsRemoved: 1,
    claimsExpired: 1,
    profilesErased: 0,
    profilesRemoved: 0,
  });
  assert.deepEqual(await runMaintenance(db, { now, limit: 1 }), {
    viewsRemoved: 0,
    auditsRemoved: 0,
    claimsExpired: 1,
    profilesErased: 0,
    profilesRemoved: 0,
  });
  assert.deepEqual(await runMaintenance(db, { now, limit: 1 }), {
    viewsRemoved: 0,
    auditsRemoved: 0,
    claimsExpired: 0,
    profilesErased: 0,
    profilesRemoved: 0,
  });
  assert.deepEqual(
    db.raw
      .prepare('SELECT id FROM staff_audits ORDER BY id')
      .all()
      .map((r) => r.id),
    ['after', 'at'],
  );
  assert.equal(count(db, 'person_views'), 2);
  assert.equal(count(db, 'welcome_claims'), 1);
  assert.equal(count(db, 'audit_retention_scope'), 0);
  assert.throws(() => db.raw.exec('DELETE FROM staff_audits'), /retention/);
  db.raw.close();
});
void test('failed maintenance rolls back deletions and never leaves deletion permission behind', async () => {
  const { runMaintenance } = await import('../src/retention');
  const db = memoryDb();
  audit(db, 'old', '2020-01-01T00:00:00.000Z');
  view(db, 'old', '2020-01-01T00:00:00.000Z');
  db.raw.exec(
    "CREATE TRIGGER fixture_retention_failure BEFORE DELETE ON audit_retention_scope BEGIN SELECT RAISE(ABORT,'fixture rollback'); END",
  );
  await assert.rejects(runMaintenance(db, { now }), /fixture rollback/);
  assert.equal(count(db, 'staff_audits'), 1);
  assert.equal(count(db, 'person_views'), 1);
  assert.equal(count(db, 'audit_retention_scope'), 0);
  assert.throws(() => db.raw.exec('DELETE FROM staff_audits'), /retention/);
  db.raw.exec('DROP TRIGGER fixture_retention_failure');
  assert.deepEqual(await runMaintenance(db, { now }), {
    viewsRemoved: 1,
    auditsRemoved: 1,
    claimsExpired: 0,
    profilesErased: 0,
    profilesRemoved: 0,
  });
  db.raw.close();
});
void test('maintenance reads current claim deadlines and protects active records and their engagement', async () => {
  const { runMaintenance } = await import('../src/retention');
  const db = memoryDb();
  db.raw
    .prepare("INSERT INTO people(id,created_at,updated_at) VALUES('active',?,?)")
    .run(now.toISOString(), now.toISOString());
  db.raw
    .prepare("INSERT INTO welcome_claims VALUES('claim','active','active',?,?)")
    .run('2026-10-01T00:00:00.000Z', now.toISOString());
  db.raw.exec("UPDATE welcome_claims SET expires_at='2026-10-11T12:00:00.000Z' WHERE id='claim'");
  db.raw.exec(
    "INSERT INTO engagement_events(id,person_id,type,occurred_at,source,created_at) VALUES('event','active','attendance','2020-01-01T00:00:00.000Z','fixture','2020-01-01T00:00:00.000Z')",
  );
  assert.deepEqual(await runMaintenance(db, { now }), {
    viewsRemoved: 0,
    auditsRemoved: 0,
    claimsExpired: 0,
    profilesErased: 0,
    profilesRemoved: 0,
  });
  assert.equal(count(db, 'people'), 1);
  assert.equal(count(db, 'engagement_events'), 1);
  assert.equal(count(db, 'welcome_claims'), 1);
  db.raw.close();
});
void test('retention authorization cannot inflate its cutoff or delete recent history', () => {
  const db = memoryDb();
  audit(db, 'recent', now.toISOString());
  assert.throws(
    () =>
      db.raw
        .prepare('INSERT INTO audit_retention_scope VALUES(1,?,?,?)')
        .run(now.toISOString(), '2026-10-04T12:00:00.000Z', '2026-10-04T12:00:00.000Z'),
    /CHECK/,
  );
  db.raw
    .prepare('INSERT INTO audit_retention_scope VALUES(1,?,?,?)')
    .run(now.toISOString(), '2025-10-04T12:00:00.000Z', '2023-10-04T12:00:00.000Z');
  assert.throws(() => db.raw.exec('DELETE FROM staff_audits'), /retention/);
  assert.equal(count(db, 'staff_audits'), 1);
  db.raw.exec('DELETE FROM audit_retention_scope');
  db.raw.close();
});
void test('calendar-year retention handles leap-day normalization and rejects an invalid clock before mutations', async () => {
  const { runMaintenance } = await import('../src/retention');
  const db = memoryDb();
  audit(db, 'leap-before', '2021-03-01T11:59:59.999Z');
  audit(db, 'leap-at', '2021-03-01T12:00:00.000Z');
  await assert.rejects(runMaintenance(db, { now: new Date('invalid') }), RangeError);
  assert.equal(count(db, 'staff_audits'), 2);
  assert.deepEqual(await runMaintenance(db, { now: new Date('2024-02-29T12:00:00.000Z') }), {
    viewsRemoved: 0,
    auditsRemoved: 1,
    claimsExpired: 0,
    profilesErased: 0,
    profilesRemoved: 0,
  });
  assert.equal(count(db, 'staff_audits'), 1);
  assert.equal(count(db, 'audit_retention_scope'), 0);
  db.raw.close();
});
