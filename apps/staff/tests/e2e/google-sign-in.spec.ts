import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { startRuntime } from '../support/runtime';

const origin = 'https://staff-preview.lasvegasfortransit.org';
const keys = await generateKeyPair('RS256');
const key = { ...(await exportJWK(keys.publicKey)), kid: 'google-runtime-fixture', alg: 'RS256' };
let nonce = '';
const fixture = await startRuntime({
  initialAdminSetup: true,
  googleOAuth: {
    key,
    token: () =>
      new SignJWT({
        email: 'admin@lasvegasfortransit.org',
        email_verified: true,
        hd: 'lasvegasfortransit.org',
        nonce,
      })
        .setProtectedHeader({ alg: 'RS256', kid: key.kid })
        .setIssuer('https://accounts.google.com')
        .setAudience('google-runtime-fixture')
        .setSubject('fixture-google-admin')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(keys.privateKey),
  },
});
const access = { 'Cf-Access-Jwt-Assertion': fixture.admin.assertion };
try {
  await fixture.db
    .prepare('DELETE FROM sessions WHERE person_id=?')
    .bind(fixture.admin.person.id)
    .run();
  const started = await fixture.simulator.dispatchFetch(
    `${origin}/sign-in/google/?next=/sign-in/initial-admin/`,
    { headers: access, redirect: 'manual' },
  );
  assert.equal(started.status, 303);
  const authorization = new URL(started.headers.get('Location') ?? '');
  assert.equal(authorization.searchParams.get('redirect_uri'), `${origin}/sign-in/google/callback`);
  nonce = authorization.searchParams.get('nonce') ?? '';
  const state = authorization.searchParams.get('state');
  assert.ok(nonce && state);
  const stateCookie = (started.headers.get('Set-Cookie') ?? '').split(';')[0];
  const callback = await fixture.simulator.dispatchFetch(
    `${origin}/sign-in/google/callback?${new URLSearchParams({ state, code: 'runtime-fixture-code' }).toString()}`,
    { headers: { ...access, Cookie: stateCookie }, redirect: 'manual' },
  );
  assert.equal(callback.status, 303);
  const destination = new URL(callback.headers.get('Location') ?? '');
  assert.equal(destination.origin, origin);
  assert.ok(destination.searchParams.has('ticket'));
  for (const Cookie of ['', `__Host-lvbt_workspace_state=${'x'.repeat(43)}`]) {
    const rejected = await fixture.simulator.dispatchFetch(destination.href, {
      headers: { ...access, Cookie },
      redirect: 'manual',
    });
    assert.equal(rejected.headers.get('Location'), '/sign-in/?google_error=1');
    assert.equal(
      (
        await fixture.db
          .prepare('SELECT count(*) AS n FROM workspace_callback_tickets')
          .first<{ n: number }>()
      )?.n,
      1,
    );
  }
  const finished = await fixture.simulator.dispatchFetch(destination.href, {
    headers: { ...access, Cookie: stateCookie },
    redirect: 'manual',
  });
  assert.equal(finished.headers.get('Location'), '/sign-in/initial-admin/');
  const sessionCookie = /__Host-lvbt_session=[^;]+/.exec(
    finished.headers.get('Set-Cookie') ?? '',
  )?.[0];
  assert.ok(sessionCookie);
  const replay = await fixture.simulator.dispatchFetch(destination.href, {
    headers: { ...access, Cookie: stateCookie },
    redirect: 'manual',
  });
  assert.equal(replay.headers.get('Location'), '/sign-in/?google_error=1');
  assert.equal(
    (await fixture.db.prepare('SELECT count(*) AS n FROM sessions').first<{ n: number }>())?.n,
    1,
  );
  const setup = await fixture.simulator.dispatchFetch(`${origin}/sign-in/initial-admin/`, {
    headers: { ...access, Cookie: sessionCookie },
    redirect: 'manual',
  });
  assert.equal(setup.status, 200);
  assert.match(await setup.text(), /Set up staff access/);
  const completed = await fixture.simulator.dispatchFetch(`${origin}/sign-in/initial-admin/`, {
    method: 'POST',
    headers: { ...access, Cookie: sessionCookie, Origin: origin },
    body: '',
    redirect: 'manual',
  });
  assert.equal(completed.status, 303);
  const roster = await fixture.simulator.dispatchFetch(`${origin}/people/`, {
    headers: { ...access, Cookie: sessionCookie },
  });
  assert.equal(roster.status, 200);
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='staff_admin.bootstrap'")
        .first<{ n: number }>()
    )?.n,
    1,
  );
  console.log(
    'Compiled staff preview completed Google verification, browser-bound session, audited first-admin setup and roster access.',
  );
} finally {
  await fixture.dispose();
}
