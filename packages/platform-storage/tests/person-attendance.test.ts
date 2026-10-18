import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import { loadActor } from '../src/staff-roles';
import type { Db } from '../src/db';

async function api() {
  const loaded = await import('../src/person-attendance').catch(() => null);
  assert.ok(loaded, 'staff need to record attendance against the exact authorized person');
  return loaded;
}
const attendance = {
  eventName: 'Neighborhood meeting',
  eventDate: '2026-09-20',
  operationId: 'attendance',
};

void test('attendance targets the viewed person, attributes the actor and ignores repeated saves without changing consent', async (t) => {
  const { recordPersonAttendance } = await api(),
    f = await mergeFixture();
  t.after(() => f.db.raw.close());
  const before = f.db.raw
    .prepare('SELECT id,membership_status,updated_at FROM people ORDER BY id')
    .all();
  const consents = f.db.raw.prepare('SELECT * FROM consent_records ORDER BY id').all();
  const input = { ...attendance, personId: f.survivor.id };
  const first = await recordPersonAttendance(f.db, f.actor, input);
  assert.equal(first.kind, 'ok');
  assert.deepEqual(await recordPersonAttendance(f.db, f.actor, input), first);
  assert.equal(
    (await recordPersonAttendance(f.db, f.actor, { ...input, operationId: 'repeat-new-form' }))
      .kind,
    'ok',
  );
  const rows = f.db.raw
    .prepare(
      "SELECT person_id,source,reference,occurred_at,details FROM engagement_events WHERE type='attended'",
    )
    .all();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row);
  assert.equal(row.person_id, f.survivor.id);
  assert.equal(row.source, 'staff');
  assert.equal(row.occurred_at, '2026-09-20T12:00:00.000Z');
  const details: unknown = JSON.parse(String(row.details));
  assert.deepEqual(details, {
    actorId: f.admin.id,
    eventName: 'Neighborhood meeting',
    eventDate: '2026-09-20',
    datePrecision: 'day',
  });
  assert.equal(
    f.db.raw
      .prepare("SELECT actor_id FROM staff_audits WHERE action='attendance.record' LIMIT 1")
      .get()?.actor_id,
    f.admin.id,
  );
  assert.deepEqual(
    f.db.raw.prepare('SELECT id,membership_status,updated_at FROM people ORDER BY id').all(),
    before,
  );
  assert.deepEqual(f.db.raw.prepare('SELECT * FROM consent_records ORDER BY id').all(), consents);
  assert.equal(
    (await recordPersonAttendance(f.db, f.actor, { ...input, personId: f.merged.id })).kind,
    'conflict',
  );
});

void test('attendance rejects invalid and future dates and missing or oversized event names', async (t) => {
  const { recordPersonAttendance } = await api(),
    f = await mergeFixture();
  t.after(() => f.db.raw.close());
  for (const values of [
    { eventDate: '2026-02-30' },
    { eventDate: '2030-01-01' },
    { eventName: ' ' },
    { eventName: 'x'.repeat(161) },
    { eventName: 'Name\nOther' },
  ]) {
    assert.equal(
      (
        await recordPersonAttendance(
          f.db,
          f.actor,
          { ...attendance, personId: f.survivor.id, ...values },
          new Date('2026-10-18T00:00:00Z'),
        )
      ).kind,
      'invalid',
    );
  }
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM engagement_events WHERE type='attended'").get()?.n,
    0,
  );
});

void test('attendance rechecks committee person scope inside the write and cannot recreate erased participation', async (t) => {
  const { recordPersonAttendance } = await api(),
    f = await mergeFixture();
  t.after(() => f.db.raw.close());
  const lead = await f.create('lead@example.invalid', 'Lead');
  for (const [personId, role] of [
    [lead.id, 'lead'],
    [f.survivor.id, 'member'],
  ] as const) {
    assert.equal(
      (
        await f.committees.assign({
          personId,
          committeeId: 'events',
          role,
          actorId: f.admin.id,
          operationId: `assign:${personId}`,
        })
      ).kind,
      'ok',
    );
  }
  const actor = await loadActor(f.db, lead.id);
  assert.ok(actor);
  assert.equal(
    (await recordPersonAttendance(f.db, actor, { ...attendance, personId: f.merged.id })).kind,
    'forbidden',
  );
  const racing: Db = {
    prepare: (sql) => f.db.prepare(sql),
    batch: async (statements) => {
      f.db.raw
        .prepare(
          "UPDATE committee_assignments SET ended_at=?,end_reason='stepped_back' WHERE person_id=?",
        )
        .run(new Date().toISOString(), lead.id);
      return f.db.batch(statements);
    },
  };
  assert.equal(
    (await recordPersonAttendance(racing, actor, { ...attendance, personId: f.survivor.id })).kind,
    'forbidden',
  );
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM engagement_events WHERE type='attended'").get()?.n,
    0,
  );
  await f.people.deletePerson(f.survivor.id);
  assert.equal(
    (await recordPersonAttendance(f.db, f.actor, { ...attendance, personId: f.survivor.id })).kind,
    'forbidden',
  );
});

void test('an attendance audit failure rolls back both participation and its operation receipt', async (t) => {
  const { recordPersonAttendance } = await api(),
    f = await mergeFixture();
  t.after(() => f.db.raw.close());
  f.db.raw.exec(
    "CREATE TRIGGER attendance_audit_failure BEFORE INSERT ON staff_audits WHEN NEW.action='attendance.record' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END",
  );
  await assert.rejects(
    () => recordPersonAttendance(f.db, f.actor, { ...attendance, personId: f.survivor.id }),
    /fixture rollback/,
  );
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM engagement_events WHERE type='attended'").get()?.n,
    0,
  );
  assert.equal(
    f.db.raw
      .prepare("SELECT count(*) AS n FROM staff_operations WHERE kind='attendance.record'")
      .get()?.n,
    0,
  );
});
