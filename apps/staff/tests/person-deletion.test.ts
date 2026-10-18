import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import { issueFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { StaffContext } from '../src/lib/context';

async function fixture() {
  const feature = await import('../src/lib/person-deletion').catch(() => null);
  assert.ok(feature, 'the explicit confirmation form needs a guarded POST handler');
  const db = memoryDb();
  const member = async (name: string) =>
    (
      await new PersonService(db).upsertFromSource({
        source: 'join_form',
        fields: { email: `${name}@example.invalid` },
        consent: {
          scope: 'newsletter',
          source: 'join_form',
          method: 'checkbox',
          wordingVersion: 'fixture',
        },
      })
    ).person;
  const admin = await member('admin'),
    target = await member('target'),
    other = await member('other');
  db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(admin.id, 'fixture', new Date().toISOString());
  const actor = await loadActor(db, admin.id);
  assert.ok(actor);
  const staff: StaffContext = { db, actor, requestId: 'fixture' };
  const token = () => issueFormToken(db, actor, `person:delete:${target.id}`);
  const request = (form: Record<string, string>, origin = 'https://staff.lasvegasfortransit.org') =>
    new Request(`https://staff.lasvegasfortransit.org/people/${target.id}/delete/`, {
      method: 'POST',
      headers: { Origin: origin },
      body: new URLSearchParams({
        action: 'delete',
        operation_id: '01K00000000000000000000000',
        expected_updated_at: target.updated_at,
        ...form,
      }),
    });
  return { ...feature, db, admin, target, other, staff, token, request };
}

void test('confirmation requires same-origin POST, current admin and a token scoped to the selected record', async () => {
  const f = await fixture();
  const token = await f.token();
  assert.equal(
    (
      await f.submitPersonDeletion(
        f.request({ token }, 'https://attacker.invalid'),
        f.staff,
        f.target.id,
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.submitPersonDeletion(f.request({ token }), f.staff, f.other.id)).status,
    409,
  );
  const forged = { ...f.staff, actor: { ...f.staff.actor, personId: f.other.id } };
  assert.equal(
    (await f.submitPersonDeletion(f.request({ token }), forged, f.target.id)).status,
    403,
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM person_deletion_log').get()?.n, 0);
  assert.equal(
    f.db.raw
      .prepare('SELECT count(*) AS n FROM staff_form_tokens WHERE actor_id=?')
      .get(f.staff.actor.personId)?.n,
    1,
    'denied submissions do not consume the legitimate token',
  );
});

void test('one explicit confirmation deletes the member; replay cannot delete again or switch targets', async () => {
  const f = await fixture();
  const token = await f.token();
  const response = await f.submitPersonDeletion(f.request({ token }), f.staff, f.target.id);
  assert.ok(response instanceof Response);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/people/?deleted=1');
  assert.equal(
    (await f.submitPersonDeletion(f.request({ token }), f.staff, f.target.id)).status,
    409,
  );
  assert.equal(
    (await f.submitPersonDeletion(f.request({ token }), f.staff, f.other.id)).status,
    409,
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM person_deletion_log').get()?.n, 1);
  assert.equal(
    f.db.raw.prepare('SELECT email FROM people WHERE id=?').get(f.other.id)?.email,
    'other@example.invalid',
  );
});

void test('stale records and a missing explicit action return usable errors without deletion', async () => {
  const f = await fixture();
  const invalid = await f.submitPersonDeletion(
    f.request({ token: await f.token(), action: '' }),
    f.staff,
    f.target.id,
  );
  assert.equal(invalid.status, 400);
  f.db.raw
    .prepare("UPDATE people SET updated_at='2099-01-01T00:00:00Z' WHERE id=?")
    .run(f.target.id);
  const stale = await f.submitPersonDeletion(
    f.request({ token: await f.token() }),
    f.staff,
    f.target.id,
  );
  assert.equal(stale.status, 409);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM person_deletion_log').get()?.n, 0);
});

void test('the final active administrator receives a transfer-access message and keeps their account', async () => {
  const f = await fixture();
  const token = await issueFormToken(f.db, f.staff.actor, `person:delete:${f.admin.id}`);
  const response = await f.submitPersonDeletion(
    f.request({ token, expected_updated_at: f.admin.updated_at }),
    f.staff,
    f.admin.id,
  );
  assert.equal(response.status, 409);
  assert.ok(!(response instanceof Response));
  assert.match(response.message, /another.*administrator/i);
  assert.equal(
    f.db.raw.prepare('SELECT erased_at FROM people WHERE id=?').get(f.admin.id)?.erased_at,
    null,
  );
});

void test('self deletion with another active administrator clears cookies and returns to sign-in with confirmation', async () => {
  const f = await fixture();
  f.db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(f.other.id, 'fixture', new Date().toISOString());
  const token = await issueFormToken(f.db, f.staff.actor, `person:delete:${f.admin.id}`);
  const response = await f.submitPersonDeletion(
    f.request({ token, expected_updated_at: f.admin.updated_at }),
    f.staff,
    f.admin.id,
  );
  assert.ok(response instanceof Response);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/sign-in/?deleted=1');
  assert.match(response.headers.get('Set-Cookie') ?? '', /__Host-lvbt_session=; Max-Age=0/);
});
