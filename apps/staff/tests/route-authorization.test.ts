import assert from 'node:assert/strict';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { bootstrapStaffAdmin } from '@lasvegasfortransit/platform-storage/staff-roles';
import {
  createWorkspaceSession,
  linkWorkspaceIdentity,
} from '@lasvegasfortransit/platform-storage/workspace-link';
import type { StaffLocals } from '../src/lib/context';
const keys = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'staff-fixture', alg: 'RS256' };
const fetcher: typeof fetch = () => Promise.resolve(Response.json({ keys: [jwk] }));
const origin = 'https://staff.lasvegasfortransit.org';
async function fixture() {
  const db = memoryDb();
  const env = {
    PLATFORM_DB: db,
    LVBT_SIGN_IN_SECRET: 'fixture-only-secret',
    LVBT_ACCESS_TEAM_DOMAIN: 'lvbt.cloudflareaccess.com',
    LVBT_ACCESS_AUD: 'staff-app',
  };
  const workspace = {
    subject: 'google-member',
    email: 'member@lasvegasfortransit.org',
    givenName: null,
    familyName: null,
  };
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'personal@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  await linkWorkspaceIdentity(db, {
    workspace,
    personId: person.id,
    method: 'self_linked',
    operationId: 'link',
  });
  await bootstrapStaffAdmin(db, {
    presidentPersonId: person.id,
    workspaceSubject: workspace.subject,
    performedBy: 'fixture-maintainer',
    operationId: 'bootstrap',
  });
  const session = await createWorkspaceSession(env, workspace);
  assert.ok(session);
  const assertion = await new SignJWT({ email: workspace.email, type: 'app' })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer('https://lvbt.cloudflareaccess.com')
    .setAudience('staff-app')
    .setSubject('access-subject-is-different')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(keys.privateKey);
  const loaded = await import('../src/lib/middleware');
  return {
    ...loaded,
    db,
    env,
    person,
    headers: {
      'Cf-Access-Jwt-Assertion': assertion,
      Cookie: `__Host-lvbt_session=${session.token}`,
    },
  };
}
function privateHeaders(response: Response) {
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('Referrer-Policy'), 'same-origin');
  assert.match(response.headers.get('Content-Security-Policy') ?? '', /frame-ancestors 'none'/);
}
void test('every staff page derives its actor from a Google-bound session and current database roles', async () => {
  const { db, env, person, headers, staffMiddleware } = await fixture();
  const locals: StaffLocals = {};
  const ok = await staffMiddleware(new Request(`${origin}/people/`, { headers }), env, {
    locals,
    fetch: fetcher,
    next: () => Promise.resolve(new Response('roster')),
  });
  assert.equal(await ok.text(), 'roster');
  assert.equal(locals.staff?.actor.personId, person.id);
  privateHeaders(ok);
  db.raw.prepare("UPDATE people SET membership_status='former_member' WHERE id=?").run(person.id);
  const withdrawn = await staffMiddleware(new Request(`${origin}/people/`, { headers }), env, {
    locals: {},
    fetch: fetcher,
    next: () => {
      assert.fail('withdrawal must prevent roster rendering');
    },
  });
  assert.equal(withdrawn.status, 303);
  privateHeaders(withdrawn);
  db.raw.close();
});
void test('invalid assertion, unknown host, cross-origin POST and missing Origin cannot reach staff handlers', async () => {
  const { db, env, headers, staffMiddleware } = await fixture();
  for (const request of [
    new Request(`${origin}/people/`),
    new Request(`${origin}/people/`, {
      headers: { ...headers, 'Cf-Access-Jwt-Assertion': 'tampered' },
    }),
    new Request('https://attacker.example/people/', { headers }),
    new Request(`${origin}/people/`, { method: 'POST', headers }),
    new Request(`${origin}/people/`, {
      method: 'POST',
      headers: { ...headers, Origin: 'https://attacker.example' },
    }),
  ]) {
    const response = await staffMiddleware(request, env, {
      locals: {},
      fetch: fetcher,
      next: () => {
        assert.fail('untrusted request must not reach handlers');
      },
    });
    assert.equal(response.status, 403);
    privateHeaders(response);
  }
  db.raw.close();
});
void test('linked volunteers without a current lead or admin designation receive a non-disclosing denial', async () => {
  const { db, env, headers, staffMiddleware } = await fixture();
  db.raw.exec('DROP TRIGGER staff_admin_keep_last; DELETE FROM staff_administrators;');
  const response = await staffMiddleware(new Request(`${origin}/people/`, { headers }), env, {
    locals: {},
    fetch: fetcher,
    next: () => {
      assert.fail('removed designation must take effect immediately');
    },
  });
  assert.equal(response.status, 403);
  assert.equal(await response.text(), "You don't have access to this");
  privateHeaders(response);
  db.raw.close();
});
void test('sign-in stays behind Access and all redirects and exceptions remain private', async () => {
  const { db, env, headers, staffMiddleware } = await fixture();
  const missingSession = await staffMiddleware(
    new Request(`${origin}/people/`, {
      headers: { 'Cf-Access-Jwt-Assertion': headers['Cf-Access-Jwt-Assertion'] },
    }),
    env,
    {
      locals: {},
      fetch: fetcher,
      next: () => {
        assert.fail('missing linked session must redirect');
      },
    },
  );
  assert.equal(missingSession.status, 303);
  privateHeaders(missingSession);
  const exception = await staffMiddleware(new Request(`${origin}/sign-in/`, { headers }), env, {
    locals: {},
    fetch: fetcher,
    next: () => {
      throw new Error('fixture-private-data');
    },
  });
  assert.equal(exception.status, 503);
  assert.equal((await exception.text()).includes('fixture-private-data'), false);
  privateHeaders(exception);
  db.raw.close();
});
void test('the Worker gateway rejects invalid Access even for assets and unknown paths', async () => {
  const { env, db } = await fixture();
  const loaded = await import('../src/lib/gateway').catch(() => null);
  assert.ok(loaded, 'all Worker responses, including assets, need Access and privacy guards');
  const response = await loaded.guardStaffGateway(new Request(`${origin}/_astro/styles.css`), env, {
    fetch: fetcher,
    next: () => {
      assert.fail('assets must stay protected');
    },
  });
  assert.equal(response.status, 403);
  privateHeaders(response);
  db.raw.close();
});
