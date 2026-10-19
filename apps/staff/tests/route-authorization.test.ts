import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { bootstrapStaffAdmin } from '@lasvegasfortransit/platform-storage/staff-roles';
import {
  createWorkspaceSession,
  linkWorkspaceIdentity,
} from '@lasvegasfortransit/platform-storage/workspace-link';
import type { StaffLocals } from '../src/lib/context';
import { staffSignInReturn, throughStaffReturn } from '../src/lib/sign-in-return';
const keys = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'staff-fixture', alg: 'RS256' };
const fetcher: typeof fetch = () => Promise.resolve(Response.json({ keys: [jwk] }));
const origin = 'https://staff.lasvegasfortransit.org';
const pagesRoot = fileURLToPath(new URL('../src/pages/', import.meta.url));
async function pageRoutes(directory = pagesRoot): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return await pageRoutes(path);
      if (!entry.isFile() || !/\.(?:astro|ts)$/.test(entry.name)) return [];
      const withoutExtension = relative(pagesRoot, path)
        .split(sep)
        .join('/')
        .replace(/\.(?:astro|ts)$/, '')
        .replace(/\[\.\.\.([^\]]+)\]/g, 'fixture-$1')
        .replace(/\[([^\]]+)\]/g, 'fixture-$1')
        .replace(/(^|\/)index$/, '');
      return [`/${withoutExtension}${withoutExtension ? '/' : ''}`];
    }),
  );
  return nested.flat();
}
async function fixture(options: { staffAdmin?: boolean } = {}) {
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
  if (options.staffAdmin !== false)
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
  assert.match(await response.text(), /You can’t open this page/);
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

void test('every route requires Access and volunteers can reach only the paper tools and sign-out', async () => {
  const routes = (await pageRoutes()).sort();
  assert.ok(routes.length > 0);
  const middleware = await readFile(new URL('../src/middleware.ts', import.meta.url), 'utf8');
  assert.match(middleware, /staffMiddleware\(request, env, \{ locals, next \}\)/);
  const { db, env, headers, staffMiddleware } = await fixture({ staffAdmin: false });
  for (const path of routes) {
    for (const method of ['GET', 'POST'] as const) {
      const requestHeaders = new Headers(method === 'POST' ? { Origin: origin } : undefined);
      const missingAccess = await staffMiddleware(
        new Request(`${origin}${path}`, { method, headers: requestHeaders }),
        env,
        {
          locals: {},
          fetch: fetcher,
          next: () => {
            assert.fail(`${method} ${path} reached its route without Cloudflare Access`);
          },
        },
      );
      assert.equal(missingAccess.status, 403, `${method} ${path} must require Access`);

      const authenticated = await staffMiddleware(
        new Request(`${origin}${path}`, { method, headers: { ...headers, Origin: origin } }),
        env,
        {
          locals: {},
          fetch: fetcher,
          next: () => Promise.resolve(new Response('route')),
        },
      );
      if (
        /^\/sign-in(?:\/|$)/.test(path) ||
        ['/paper/', '/paper/sheet/', '/sign-out/'].includes(path)
      )
        assert.equal(
          authenticated.status,
          200,
          `${method} ${path} stays available to link members`,
        );
      else if (path === '/' && method === 'GET') {
        assert.equal(authenticated.status, 303);
        assert.equal(authenticated.headers.get('Location'), '/paper/');
      } else
        assert.equal(
          authenticated.status,
          403,
          `${method} ${path} must require an authorized committee lead or staff administrator`,
        );
    }
  }
  db.raw.close();
});

void test('paper-only admission still checks membership and linked session on each request', async () => {
  const { db, env, person, headers, staffMiddleware } = await fixture({ staffAdmin: false });
  for (const path of ['/paper/', '/paper/sheet/']) {
    const response = await staffMiddleware(new Request(`${origin}${path}`, { headers }), env, {
      locals: {},
      fetch: fetcher,
      next: () => Promise.resolve(new Response('paper')),
    });
    assert.equal(response.status, 200);
    privateHeaders(response);
  }
  db.raw.prepare("UPDATE people SET membership_status='former_member' WHERE id=?").run(person.id);
  for (const path of ['/paper/', '/paper/sheet/']) {
    const response = await staffMiddleware(new Request(`${origin}${path}`, { headers }), env, {
      locals: {},
      fetch: fetcher,
      next: () => assert.fail('former member must not reach paper tools'),
    });
    assert.equal(response.status, 303);
    assert.match(response.headers.get('Location') ?? '', /^\/sign-in\//);
  }
  db.raw.close();
});

void test('revoked sessions or removed Workspace links immediately deny paper access', async () => {
  for (const revoke of ['session', 'identity'] as const) {
    const { db, env, person, headers, staffMiddleware } = await fixture({ staffAdmin: false });
    if (revoke === 'session')
      db.raw.prepare('DELETE FROM sessions WHERE person_id=?').run(person.id);
    else
      db.raw
        .prepare("DELETE FROM identities WHERE platform='google_workspace' AND person_id=?")
        .run(person.id);
    for (const path of ['/paper/', '/paper/sheet/']) {
      const response = await staffMiddleware(new Request(`${origin}${path}`, { headers }), env, {
        locals: {},
        fetch: fetcher,
        next: () => assert.fail('revoked identity must not reach paper tools'),
      });
      assert.equal(response.status, 303);
    }
    db.raw.close();
  }
});

void test('staff sign-in returns a verified volunteer only to paper destinations', async () => {
  const { db, env, headers } = await fixture({ staffAdmin: false });
  const access = { email: 'member@lasvegasfortransit.org', subject: 'access-fixture' };
  for (const next of [
    '/people/?q=private',
    '/people/other/',
    '/export/',
    '/staff-admin/',
    '/',
    'https://attacker.invalid/',
    '//attacker.invalid/',
    '/sign-in/return/',
  ]) {
    const response = await staffSignInReturn(
      env,
      new Request(`${origin}/sign-in/return/?next=${encodeURIComponent(next)}`, { headers }),
      access,
    );
    assert.equal(response.headers.get('Location'), '/paper/');
  }
  const sheet = await staffSignInReturn(
    env,
    new Request(`${origin}/sign-in/return/?next=${encodeURIComponent('/paper/sheet/')}`, {
      headers,
    }),
    access,
  );
  assert.equal(sheet.headers.get('Location'), '/paper/sheet/');
  const mismatch = await staffSignInReturn(
    env,
    new Request(`${origin}/sign-in/return/`, { headers }),
    { ...access, email: 'other@lasvegasfortransit.org' },
  );
  assert.equal(mismatch.headers.get('Location'), '/sign-in/');
  const response = new Response(null, {
    status: 303,
    headers: {
      Location: '/people/',
      'Set-Cookie': '__Host-lvbt_session=fixture; HttpOnly; Secure; Path=/',
    },
  });
  const returned = throughStaffReturn(response);
  assert.equal(returned.headers.get('Location'), '/sign-in/return/?next=%2Fpeople%2F');
  assert.equal(returned.headers.get('Set-Cookie'), response.headers.get('Set-Cookie'));
  assert.equal(
    throughStaffReturn(
      new Response(null, { status: 303, headers: { Location: '/sign-in/?google_error=1' } }),
    ).headers.get('Location'),
    '/sign-in/?google_error=1',
  );
  db.raw.close();
});
