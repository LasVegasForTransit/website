import assert from 'node:assert/strict';
import test from 'node:test';
import { issueFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import { mergeFixture } from '../../../packages/platform-storage/tests/support/merge-fixture';

async function api() {
  const loaded = await import('../src/lib/person-attendance').catch(() => null);
  assert.ok(loaded, 'the profile needs a direct native attendance form');
  return loaded;
}
void test('native attendance posts to the exact profile and requires origin plus a subject-bound single-use token', async (t) => {
  const { submitPersonAttendance, attendanceTokenAction } = await api(),
    f = await mergeFixture();
  t.after(() => f.db.raw.close());
  const token = await issueFormToken(f.db, f.actor, attendanceTokenAction(f.merged.id));
  const fields = {
    token,
    event_name: 'Bus ride',
    event_date: '2026-09-20',
    operation_id: 'native',
    person_id: f.survivor.id,
  };
  const request = (origin: string) =>
    new Request(`https://staff.example.invalid/people/${f.merged.id}/attendance/`, {
      method: 'POST',
      headers: { Origin: origin },
      body: new URLSearchParams(fields),
    });
  const staff = { db: f.db, actor: f.actor, requestId: 'fixture' };
  const denied = await submitPersonAttendance(
    request('https://elsewhere.invalid'),
    staff,
    f.merged.id,
  );
  assert.ok(denied instanceof Response);
  assert.equal(denied.status, 403);
  const wrongPerson = await submitPersonAttendance(
    request('https://staff.example.invalid'),
    staff,
    f.survivor.id,
  );
  assert.ok(!(wrongPerson instanceof Response));
  assert.equal(wrongPerson.status, 409);
  const saved = await submitPersonAttendance(
    request('https://staff.example.invalid'),
    staff,
    f.merged.id,
  );
  assert.ok(saved instanceof Response);
  assert.equal(saved.status, 303);
  assert.equal(saved.headers.get('Location'), `/people/${f.merged.id}/#participation-heading`);
  assert.equal(
    f.db.raw.prepare("SELECT person_id FROM engagement_events WHERE type='attended'").get()
      ?.person_id,
    f.merged.id,
  );
  const repeated = await submitPersonAttendance(
    request('https://staff.example.invalid'),
    staff,
    f.merged.id,
  );
  assert.ok(!(repeated instanceof Response));
  assert.equal(repeated.status, 409);
});

void test('invalid attendance retains entered fields and storage failures remain retryable without exposing internals', async (t) => {
  const { submitPersonAttendance, attendanceTokenAction } = await api(),
    f = await mergeFixture();
  t.after(() => f.db.raw.close());
  const staff = { db: f.db, actor: f.actor, requestId: 'fixture' };
  const request = async (date: string) =>
    new Request(`https://staff.example.invalid/people/${f.merged.id}/attendance/`, {
      method: 'POST',
      headers: { Origin: 'https://staff.example.invalid' },
      body: new URLSearchParams({
        token: await issueFormToken(f.db, f.actor, attendanceTokenAction(f.merged.id)),
        event_name: 'Bus ride',
        event_date: date,
        operation_id: 'retry',
      }),
    });
  const invalid = await submitPersonAttendance(await request('2026-02-30'), staff, f.merged.id);
  assert.ok(!(invalid instanceof Response));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.input.eventName, 'Bus ride');
  assert.equal(invalid.input.eventDate, '2026-02-30');
  assert.ok(invalid.errors.eventDate);
  f.db.raw.exec(
    "CREATE TRIGGER fixture_attendance_failure BEFORE INSERT ON engagement_events WHEN NEW.type='attended' BEGIN SELECT RAISE(ABORT,'private storage failure'); END",
  );
  const failed = await submitPersonAttendance(await request('2026-09-20'), staff, f.merged.id);
  assert.ok(!(failed instanceof Response));
  assert.equal(failed.status, 503);
  assert.equal(failed.input.operationId, 'retry');
  assert.doesNotMatch(failed.message, /private storage failure/);
});
