import assert from 'node:assert/strict';
import { ORIGIN, startRuntime } from '../support/runtime';

const fixture = await startRuntime({ initialAdminSetup: true });
const headers = {
  'Cf-Access-Jwt-Assertion': fixture.admin.assertion,
  Cookie: `__Host-lvbt_session=${fixture.admin.session.token}`,
};
try {
  const signIn = await fixture.simulator.dispatchFetch(`${ORIGIN}/sign-in/`, {
    headers: { 'Cf-Access-Jwt-Assertion': fixture.admin.assertion },
    redirect: 'manual',
  });
  assert.equal(signIn.status, 303);
  assert.equal(
    signIn.headers.get('Location'),
    '/sign-in/ready/?next=%2Fsign-in%2Finitial-admin%2F',
  );
  assert.ok(!signIn.headers.get('Location')?.includes('google'));

  const expired = await fixture.simulator.dispatchFetch(`${ORIGIN}/sign-in/link-account/`, {
    headers: { 'Cf-Access-Jwt-Assertion': fixture.admin.assertion },
    redirect: 'manual',
  });
  assert.equal(expired.status, 303);
  assert.equal(expired.headers.get('Location'), '/sign-in/?membership_confirmation_expired=1');
  assert.match(
    expired.headers.get('Set-Cookie') ?? '',
    /__Host-lvbt_workspace_pending=; Max-Age=0/,
  );
  const recovery = await fixture.simulator.dispatchFetch(
    `${ORIGIN}${expired.headers.get('Location') ?? ''}`,
    { headers: { 'Cf-Access-Jwt-Assertion': fixture.admin.assertion }, redirect: 'manual' },
  );
  assert.equal(recovery.status, 303);
  assert.equal(
    recovery.headers.get('Location'),
    '/sign-in/ready/?next=%2Fsign-in%2Finitial-admin%2F',
  );

  const setup = await fixture.simulator.dispatchFetch(`${ORIGIN}/sign-in/initial-admin/`, {
    headers,
  });
  const setupHtml = await setup.text();
  assert.equal(setup.status, 200, setupHtml);
  assert.match(setupHtml, /Set up staff access/);
  assert.equal(setupHtml.includes(fixture.admin.person.id), false);
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT count(*) AS n FROM staff_administrators')
        .first<{ n: number }>()
    )?.n,
    0,
  );

  const completed = await fixture.simulator.dispatchFetch(`${ORIGIN}/sign-in/initial-admin/`, {
    redirect: 'manual',
    method: 'POST',
    headers: {
      ...headers,
      Origin: ORIGIN,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: '',
  });
  assert.equal(completed.status, 303);
  assert.equal(completed.headers.get('Location'), '/');
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT count(*) AS n FROM staff_administrators')
        .first<{ n: number }>()
    )?.n,
    1,
  );
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='staff_admin.bootstrap'")
        .first<{ n: number }>()
    )?.n,
    1,
  );

  const roster = await fixture.simulator.dispatchFetch(`${ORIGIN}/people/`, { headers });
  assert.equal(roster.status, 200);
  const repeat = await fixture.simulator.dispatchFetch(`${ORIGIN}/sign-in/initial-admin/`, {
    redirect: 'manual',
    method: 'POST',
    headers: {
      ...headers,
      Origin: ORIGIN,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: '',
  });
  assert.equal(repeat.status, 303);
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT count(*) AS n FROM staff_administrators')
        .first<{ n: number }>()
    )?.n,
    1,
  );
  console.log('Initial staff administrator setup completed once for the configured active member.');
} finally {
  await fixture.dispose();
}
