import assert from 'node:assert/strict';
import {
  beginMemberHandoff,
  staffHandoffProof,
} from '@lasvegasfortransit/platform-storage/staff-member-handoff';
import { WorkspaceLinkService } from '@lasvegasfortransit/platform-storage/workspace-link';
import { accountDataRuntime, ACCOUNT_ORIGIN } from '../runtime/support/account-data-runtime';
const fixture = await accountDataRuntime();
try {
  const env = { PLATFORM_DB: fixture.db, LVBT_SIGN_IN_SECRET: 'account-data-fixture-only' };
  const service = new WorkspaceLinkService(env);
  const pending = await service.begin(
    {
      subject: 'handoff-google',
      email: 'handoff@lasvegasfortransit.org',
      givenName: null,
      familyName: null,
    },
    { returnTo: '/paper/' },
  );
  const token = await beginMemberHandoff(env, pending, {
    mode: 'google',
    staffOrigin: 'https://staff.lasvegasfortransit.org',
  });
  const url = `${ACCOUNT_ORIGIN}/sign-in/staff-link/?request=${token}`;
  const signedOut = await fixture.simulator.dispatchFetch(url, { redirect: 'manual' });
  assert.equal(signedOut.status, 303);
  assert.match(signedOut.headers.get('Location') ?? '', /^\/sign-in\/\?next=/);
  await signedOut.arrayBuffer();
  const cookie = `__Host-lvbt_session=${fixture.session.token}`;
  const get = await fixture.simulator.dispatchFetch(url, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  assert.equal(get.status, 200);
  const html = await get.text();
  assert.match(html, /Connect to the Staff Portal/);
  assert.match(html, /account-rider@example.invalid/);
  const bad = await fixture.simulator.dispatchFetch(url, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://attacker.invalid' },
    body: new URLSearchParams({ request: token }),
    redirect: 'manual',
  });
  assert.equal(bad.status, 403);
  await bad.arrayBuffer();
  const approved = await fixture.simulator.dispatchFetch(url, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: ACCOUNT_ORIGIN },
    body: new URLSearchParams({ request: token }),
    redirect: 'manual',
  });
  assert.equal(approved.status, 303);
  assert.equal(
    approved.headers.get('Location'),
    'https://staff.lasvegasfortransit.org/sign-in/link-account/',
  );
  await approved.arrayBuffer();
  assert.equal(
    await staffHandoffProof(env, token, { pending: 'wrong-browser', mode: 'google' }),
    null,
  );
  const proof = await staffHandoffProof(env, token, { pending, mode: 'google' });
  assert.ok(proof);
  const completed = await service.completeForMemberProof(pending, proof.sessionHash);
  assert.equal(completed.kind, 'ok');
  assert.equal(completed.personId, fixture.person.id);
  assert.notEqual((await service.completeForMemberProof(pending, proof.sessionHash)).kind, 'ok');
  console.log(
    'Compiled member-site handoff: host-only member session, CSRF rejection, verified account display, portal-bound completion and replay refusal passed.',
  );
} finally {
  await fixture.dispose();
}
