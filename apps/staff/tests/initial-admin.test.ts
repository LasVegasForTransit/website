import { ssoSessionFixture, ssoPrincipalFixture } from './support/sso';
import assert from 'node:assert/strict';
import test from 'node:test';
import { SESSION_COOKIE } from '@lasvegasfortransit/platform-core/web-auth';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { linkWorkspaceIdentity } from '@lasvegasfortransit/platform-storage/workspace-link';
import { bootstrapInitialStaffAdmin, getInitialStaffAdminState } from '../src/lib/initial-admin';

const origin = 'https://staff.lasvegasfortransit.org';
const consent = {
  scope: 'newsletter' as const,
  source: 'join_form' as const,
  method: 'checkbox' as const,
  wordingVersion: 'join-form-v1',
};

async function fixture(options: { configured?: boolean; admin?: boolean } = {}) {
  const db = memoryDb();
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'president@example.org' },
    consent,
  });
  const workspace = {
    subject: 'president-google-subject',
    email: 'president@lasvegasfortransit.org',
    givenName: null,
    familyName: null,
  };
  await linkWorkspaceIdentity(db, {
    workspace,
    personId: person.id,
    method: 'self_linked',
    operationId: 'president-link',
  });
  const env = {
    PLATFORM_DB: db,
    LVBT_SIGN_IN_SECRET: 'fixture-only-secret',
    ...(options.configured === false
      ? {}
      : { LVBT_INITIAL_STAFF_ADMIN_WORKSPACE_EMAIL: workspace.email }),
  };
  const access = ssoPrincipalFixture(workspace.email, 'fixture-cloudflare-subject');
  const session = await ssoSessionFixture(env, person.id, access);
  assert.ok(session);
  const sessionToken = session.token;
  if (options.admin) {
    const { bootstrapStaffAdmin } =
      await import('@lasvegasfortransit/platform-storage/staff-roles');
    assert.equal(
      (
        await bootstrapStaffAdmin(db, {
          presidentPersonId: person.id,
          workspaceSubject: workspace.subject,
          performedBy: 'fixture-maintainer',
          operationId: 'existing-admin',
        })
      ).kind,
      'ok',
    );
  }
  function request(method: 'GET' | 'POST' = 'GET', requestOrigin = origin) {
    const headers = new Headers({ Cookie: `${SESSION_COOKIE}=${sessionToken}` });
    if (method === 'POST' && requestOrigin) headers.set('Origin', requestOrigin);
    return new Request(`${origin}/sign-in/initial-admin/`, { method, headers });
  }
  return { db, env, person, workspace, access, request };
}

void test('the configured active member can designate the first administrator once', async () => {
  const f = await fixture();
  assert.deepEqual(await getInitialStaffAdminState(f.env, f.request(), f.access), {
    kind: 'ready',
  });
  assert.deepEqual(await bootstrapInitialStaffAdmin(f.env, f.request('POST'), f.access), {
    kind: 'ok',
  });
  assert.deepEqual(await getInitialStaffAdminState(f.env, f.request(), f.access), {
    kind: 'already_initialized',
  });
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_administrators').get()?.n, 1);
  assert.equal(
    f.db.raw
      .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='staff_admin.bootstrap'")
      .get()?.n,
    1,
  );
  f.db.raw.close();
});

void test('an unconfigured, unmatched, or differently authenticated account cannot bootstrap', async () => {
  const f = await fixture();
  assert.deepEqual(
    await getInitialStaffAdminState(
      { ...f.env, LVBT_INITIAL_STAFF_ADMIN_WORKSPACE_EMAIL: undefined },
      f.request(),
      f.access,
    ),
    { kind: 'unconfigured' },
  );
  assert.deepEqual(
    await getInitialStaffAdminState(
      { ...f.env, LVBT_INITIAL_STAFF_ADMIN_WORKSPACE_EMAIL: 'other@lasvegasfortransit.org' },
      f.request(),
      f.access,
    ),
    { kind: 'not_authorized' },
  );
  assert.deepEqual(
    await getInitialStaffAdminState(f.env, f.request(), {
      ...f.access,
      subject: 'different-subject',
    }),
    { kind: 'needs_sign_in' },
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_administrators').get()?.n, 0);
  f.db.raw.close();
});

void test('first-admin setup requires an authenticated session and same-origin POST', async () => {
  const f = await fixture();
  assert.deepEqual(
    await getInitialStaffAdminState(
      f.env,
      new Request(`${origin}/sign-in/initial-admin/`),
      f.access,
    ),
    {
      kind: 'needs_sign_in',
    },
  );
  assert.deepEqual(
    await bootstrapInitialStaffAdmin(
      f.env,
      f.request('POST', 'https://attacker.example'),
      f.access,
    ),
    { kind: 'invalid_request' },
  );
  assert.deepEqual(await bootstrapInitialStaffAdmin(f.env, f.request(), f.access), {
    kind: 'invalid_request',
  });
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_administrators').get()?.n, 0);
  f.db.raw.close();
});

void test('an existing administrator cannot be replaced through initial setup', async () => {
  const f = await fixture({ admin: true });
  assert.deepEqual(await getInitialStaffAdminState(f.env, f.request(), f.access), {
    kind: 'already_initialized',
  });
  assert.deepEqual(await bootstrapInitialStaffAdmin(f.env, f.request('POST'), f.access), {
    kind: 'already_initialized',
  });
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_administrators').get()?.n, 1);
  f.db.raw.close();
});
