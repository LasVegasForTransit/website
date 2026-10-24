import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { staffMiddleware } from '../src/lib/middleware';
import { guardStaffGateway } from '../src/lib/gateway';
const origin = 'https://staff.example.org';
const neverFetch: typeof fetch = () => assert.fail('direct mode must never contact Access');
void test('direct Google deployment serves sign-in without Access configuration or network calls', async () => {
  const db = memoryDb();
  const env = {
    PLATFORM_DB: db,
    LVBT_SIGN_IN_SECRET: 'test-only',
    LVBT_STAFF_AUTH_MODE: 'google',
    LVBT_STAFF_ORIGIN: origin,
  };
  const response = await guardStaffGateway(new Request(`${origin}/sign-in/`), env, {
    fetch: neverFetch,
    next: () =>
      staffMiddleware(new Request(`${origin}/sign-in/`), env, {
        locals: {},
        fetch: neverFetch,
        next: () => Promise.resolve(new Response('Google sign-in')),
      }),
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'Google sign-in');
  const protectedResponse = await staffMiddleware(
    new Request(`${origin}/people/`, { headers: { 'Cf-Access-Jwt-Assertion': 'spoof' } }),
    env,
    {
      locals: {},
      fetch: neverFetch,
      next: () => assert.fail('spoofed Access cannot create a direct-mode session'),
    },
  );
  assert.equal(protectedResponse.status, 303);
  db.raw.close();
});
void test('invalid authentication mode cannot reach any route or asset', async () => {
  const db = memoryDb();
  const env = {
    PLATFORM_DB: db,
    LVBT_SIGN_IN_SECRET: 'test-only',
    LVBT_STAFF_AUTH_MODE: 'auto',
    LVBT_STAFF_ORIGIN: origin,
  };
  for (const path of ['/sign-in/', '/_astro/styles.css']) {
    const response = await guardStaffGateway(new Request(`${origin}${path}`), env, {
      next: () => assert.fail('invalid mode reached gateway'),
      fetch: neverFetch,
    });
    assert.equal(response.status, 503);
  }
  db.raw.close();
});
void test('a missing session on POST is refused without replay after authentication', async () => {
  const db = memoryDb();
  const env = {
    PLATFORM_DB: db,
    LVBT_SIGN_IN_SECRET: 'test-only',
    LVBT_STAFF_AUTH_MODE: 'google',
    LVBT_STAFF_ORIGIN: origin,
  };
  const response = await staffMiddleware(
    new Request(`${origin}/people/`, { method: 'POST', headers: { Origin: origin } }),
    env,
    {
      locals: {},
      fetch: neverFetch,
      next: () => assert.fail('unauthenticated POST reached route'),
    },
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.has('Location'), false);
  db.raw.close();
});

void test('known SSO principal enters without Google while an unknown principal confirms membership once', async () => {
  const { PersonService } = await import('@lasvegasfortransit/platform-storage/person-service');
  const { ssoSessionFixture, ssoPrincipalFixture } = await import('./support/sso');
  const { startSsoSignIn } = await import('../src/lib/sso-sign-in');
  const { SsoLinkService, revokeSsoPrincipal } =
    await import('@lasvegasfortransit/platform-storage/staff-sso');
  const db = memoryDb();
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only', LVBT_STAFF_ORIGIN: origin };
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'member@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  const principal = ssoPrincipalFixture('member@lasvegasfortransit.org', 'access-member');
  await ssoSessionFixture(env, person.id, principal);
  const request = new Request(`${origin}/sign-in/?next=%2Fpaper%2F`);
  const continued = await startSsoSignIn(env, request, principal);
  assert.equal(continued?.headers.get('Location'), '/sign-in/ready/?next=%2Fpaper%2F');
  assert.match(continued.headers.get('Set-Cookie') ?? '', /__Host-lvbt_session=/);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM workspace_oauth_states').get()?.n, 0);
  const unknown = { ...principal, subject: 'new-access-subject' };
  const linking = await startSsoSignIn(env, request, unknown);
  assert.equal(linking?.headers.get('Location'), '/sign-in/link-account/');
  const token = /__Host-lvbt_workspace_pending=([^;]+)/.exec(
    linking.headers.get('Set-Cookie') ?? '',
  )?.[1];
  assert.ok(token);
  const service = new SsoLinkService(env);
  const code = await service.requestCode(token, {
    email: 'member@example.invalid',
    callerAddress: 'fixture',
  });
  assert.equal(code.kind, 'issued');
  assert.equal(
    (await service.complete(token, { email: 'member@example.invalid', code: code.issued.code }))
      .kind,
    'ok',
  );
  assert.equal(
    (await startSsoSignIn(env, request, unknown))?.headers.get('Location'),
    '/sign-in/ready/?next=%2Fpaper%2F',
  );
  await revokeSsoPrincipal(db, unknown);
  assert.equal((await startSsoSignIn(env, request, unknown))?.status, 403);
  db.raw.close();
});

void test('sessions from the other provider never authorize a mode switch', async () => {
  const { PersonService } = await import('@lasvegasfortransit/platform-storage/person-service');
  const { createWorkspaceSession, linkWorkspaceIdentity } =
    await import('@lasvegasfortransit/platform-storage/workspace-link');
  const { readStaffSession } = await import('../src/lib/staff-session');
  const { ssoSessionFixture, ssoPrincipalFixture } = await import('./support/sso');
  const db = memoryDb();
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only' };
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'portable@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  const workspace = {
    subject: 'real-google-id',
    email: 'member@lasvegasfortransit.org',
    givenName: null,
    familyName: null,
  };
  await linkWorkspaceIdentity(db, {
    workspace,
    personId: person.id,
    method: 'self_linked',
    operationId: 'fixture-google',
  });
  const google = await createWorkspaceSession(env, workspace);
  assert.ok(google);
  const principal = ssoPrincipalFixture(workspace.email, 'different-access-id');
  const sso = await ssoSessionFixture(env, person.id, principal);
  const request = (token: string) =>
    new Request(`${origin}/paper/`, { headers: { Cookie: `__Host-lvbt_session=${token}` } });
  assert.equal(await readStaffSession(env, request(google.token), principal), null);
  assert.equal(
    await readStaffSession({ ...env, LVBT_STAFF_AUTH_MODE: 'google' }, request(sso.token)),
    null,
  );
  assert.equal(
    (await readStaffSession({ ...env, LVBT_STAFF_AUTH_MODE: 'google' }, request(google.token)))
      ?.personId,
    person.id,
  );
  assert.equal(
    db.raw.prepare("SELECT external_id FROM identities WHERE platform='google_workspace'").get()
      ?.external_id,
    'real-google-id',
  );
  db.raw.close();
});

void test('SSO preserves sign-out notices after deleting an account or removing own administrator role', async () => {
  const { startSsoSignIn } = await import('../src/lib/sso-sign-in');
  const { ssoPrincipalFixture } = await import('./support/sso');
  const db = memoryDb();
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only' };
  for (const flag of ['deleted', 'administrator_removed']) {
    const response = await startSsoSignIn(
      env,
      new Request(`https://staff.lasvegasfortransit.org/sign-in/?${flag}=1`),
      ssoPrincipalFixture('member@lasvegasfortransit.org', 'access-member'),
    );
    assert.equal(response, null, 'the confirmation must be visible before explicit continuation');
  }
  db.raw.close();
});
