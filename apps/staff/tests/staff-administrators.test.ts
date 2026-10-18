import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import { linkWorkspaceIdentity } from '@lasvegasfortransit/platform-storage/workspace-link';
import { issueFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import { createSession, readSession } from '@lasvegasfortransit/platform-storage/auth';
import type { StaffContext } from '../src/lib/context';

const origin = 'https://staff.lasvegasfortransit.org';
const stamp = '2026-10-17T00:00:00.000Z';
async function fixture() {
  const feature = await import('../src/lib/staff-administrators').catch(() => null);
  assert.ok(feature, 'administrator changes need a guarded confirmation handler');
  const db = memoryDb();
  const people = new PersonService(db);
  const member = async (name: string, linked = true) => {
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { given_name: name, email: `${name}@example.invalid` },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    if (linked)
      await linkWorkspaceIdentity(db, {
        workspace: {
          subject: `${name}-google`,
          email: `${name}@lasvegasfortransit.org`,
          givenName: null,
          familyName: null,
        },
        personId: person.id,
        method: 'self_linked',
        operationId: `fixture-${name}`,
      });
    return person;
  };
  const admin = await member('admin');
  const target = await member('target');
  const other = await member('other');
  const unlinked = await member('unlinked', false);
  db.raw.prepare('INSERT INTO staff_administrators VALUES(?,?,?)').run(admin.id, 'fixture', stamp);
  const actor = await loadActor(db, admin.id);
  assert.ok(actor);
  const staff: StaffContext = { db, actor, requestId: 'fixture' };
  const token = (id = target.id, action = 'grant') =>
    issueFormToken(db, actor, `staff_admin:${action}:${id}`);
  const request = (
    values: Record<string, string>,
    options: { id?: string; origin?: string; method?: string; cookie?: string } = {},
  ) =>
    new Request(`${origin}/administrators/${options.id ?? target.id}/?action=grant`, {
      method: options.method ?? 'POST',
      headers: { Origin: options.origin ?? origin, Cookie: options.cookie ?? '' },
      ...((options.method ?? 'POST') === 'POST'
        ? {
            body: new URLSearchParams({
              action: 'grant',
              operation_id: '01K00000000000000000000000',
              expected_updated_at: target.updated_at,
              expected_designated_at: '',
              ...values,
            }),
          }
        : {}),
    });
  const signInSecret = 'administrator-handler-test-secret';
  const submit = (request: Request, id = target.id, context = staff) =>
    feature.submitStaffAdministrator(request, context, id, signInSecret);
  const count = () =>
    db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='staff_admin.manage'").get()
      ?.n;
  return {
    ...feature,
    db,
    people,
    admin,
    target,
    other,
    unlinked,
    staff,
    token,
    request,
    submit,
    count,
    signInSecret,
  };
}

void test('confirmation requires same-origin POST and a fresh administrator before consuming a token', async () => {
  const f = await fixture();
  const token = await f.token();
  assert.equal(
    (await f.submit(f.request({ token }, { origin: 'https://attacker.invalid' }))).status,
    403,
  );
  assert.equal((await f.submit(f.request({}, { method: 'GET' }))).status, 403);
  f.db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(f.other.id, 'fixture', stamp);
  f.db.raw.prepare('DELETE FROM staff_administrators WHERE person_id=?').run(f.admin.id);
  assert.equal((await f.submit(f.request({ token }))).status, 403);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_form_tokens').get()?.n, 1);
  assert.equal(f.count(), 0);
});

void test('the confirmation token cannot switch target or grant versus remove action', async () => {
  const f = await fixture();
  const token = await f.token();
  assert.equal((await f.submit(f.request({ token }), f.other.id)).status, 409);
  assert.equal((await f.submit(f.request({ token, action: 'revoke' }))).status, 409);
  assert.equal(f.count(), 0);
});

void test('one explicit confirmation grants access once and replay cannot apply another change', async () => {
  const f = await fixture();
  const token = await f.token();
  const result = await f.submit(f.request({ token }));
  assert.ok(result instanceof Response);
  assert.equal(result.status, 303);
  assert.equal(result.headers.get('Location'), '/administrators/?added=1');
  assert.equal((await loadActor(f.db, f.target.id))?.staffAdmin, true);
  assert.equal(f.count(), 1);
  assert.equal((await f.submit(f.request({ token }))).status, 409);
  assert.equal(f.count(), 1);
});

void test('invalid explicit actions and operation IDs never reach administrator history', async () => {
  const f = await fixture();
  const invalidValues: Record<string, string>[] = [
    { action: '' },
    { operation_id: 'admin@example.invalid' },
    { operation_id: '01K00000000000000000000000-extra' },
    { operation_id: 'Z1K00000000000000000000000' },
  ];
  for (const values of invalidValues) {
    assert.equal((await f.submit(f.request({ token: await f.token(), ...values }))).status, 400);
  }
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_form_tokens').get()?.n, 4);
  assert.equal(f.count(), 0);
  assert.equal((await loadActor(f.db, f.target.id))?.staffAdmin, false);
});

void test('changed member records and administrator designations require a fresh review', async () => {
  const f = await fixture();
  f.db.raw
    .prepare("UPDATE people SET updated_at='2099-01-01T00:00:00.000Z' WHERE id=?")
    .run(f.target.id);
  const changed = await f.submit(f.request({ token: await f.token() }));
  assert.equal(changed.status, 409);
  assert.ok(!(changed instanceof Response));
  assert.match(changed.message, /review/i);
  f.db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(f.other.id, 'fixture', stamp);
  const designation = await f.submit(
    f.request({ token: await f.token(f.other.id), expected_updated_at: f.other.updated_at }),
    f.other.id,
  );
  assert.equal(designation.status, 409);
  assert.equal(f.count(), 0);
});

void test('current membership and connected LVBT Google identity are required to grant access', async () => {
  const f = await fixture();
  for (const person of [f.unlinked, f.target]) {
    if (person.id === f.target.id)
      f.db.raw
        .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
        .run(person.id);
    const result = await f.submit(
      f.request({ token: await f.token(person.id), expected_updated_at: person.updated_at }),
      person.id,
    );
    assert.ok(result.status === 400 || result.status === 409);
    assert.equal((await loadActor(f.db, person.id))?.staffAdmin, false);
  }
  assert.equal(f.count(), 0);
});

void test('former-member administrator rows do not permit removing the last active administrator', async () => {
  const f = await fixture();
  f.db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(f.other.id, 'fixture', stamp);
  f.db.raw
    .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
    .run(f.other.id);
  const result = await f.submit(
    f.request({
      token: await f.token(f.admin.id, 'revoke'),
      action: 'revoke',
      expected_updated_at: f.admin.updated_at,
      expected_designated_at: stamp,
    }),
    f.admin.id,
  );
  assert.equal(result.status, 409);
  assert.ok(!(result instanceof Response));
  assert.match(result.message, /another.*administrator/i);
  assert.equal((await loadActor(f.db, f.admin.id))?.staffAdmin, true);
  assert.equal(f.count(), 0);
});

void test('self removal with a backup administrator clears cookies and returns to sign-in', async () => {
  const f = await fixture();
  f.db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(f.other.id, 'fixture', stamp);
  const env = { PLATFORM_DB: f.db, LVBT_SIGN_IN_SECRET: f.signInSecret };
  const currentSession = await createSession(env, f.admin.id, 'staff');
  const otherSession = await createSession(env, f.admin.id, 'staff');
  const result = await f.submit(
    f.request(
      {
        token: await f.token(f.admin.id, 'revoke'),
        action: 'revoke',
        expected_updated_at: f.admin.updated_at,
        expected_designated_at: stamp,
      },
      { cookie: `__Host-lvbt_session=${currentSession.token}` },
    ),
    f.admin.id,
  );
  assert.ok(result instanceof Response);
  assert.equal(result.status, 303);
  assert.equal(result.headers.get('Location'), '/sign-in/?administrator_removed=1');
  assert.match(result.headers.get('Set-Cookie') ?? '', /__Host-lvbt_session=; Max-Age=0/);
  assert.equal((await loadActor(f.db, f.admin.id))?.staffAdmin, false);
  assert.equal((await loadActor(f.db, f.other.id))?.staffAdmin, true);
  assert.equal(await readSession(env, currentSession.token), null);
  assert.ok(
    await readSession(env, otherSession.token),
    'other sessions retain member and committee access',
  );
  assert.equal(f.count(), 1);
});
