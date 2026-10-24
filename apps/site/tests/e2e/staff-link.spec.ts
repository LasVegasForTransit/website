import assert from 'node:assert/strict';
import { createSession } from '@lasvegasfortransit/platform-storage/auth';
import { approveHandoffInBrowser } from '../runtime/support/staff-handoff-browser';
import {
  beginMemberHandoff,
  staffHandoffProof,
} from '@lasvegasfortransit/platform-storage/staff-member-handoff';
import { SsoLinkService } from '@lasvegasfortransit/platform-storage/staff-sso';
import { WorkspaceLinkService } from '@lasvegasfortransit/platform-storage/workspace-link';
import { accountDataRuntime, ACCOUNT_ORIGIN } from '../runtime/support/account-data-runtime';
const journeys = (['google', 'cloudflare-access'] as const).flatMap((mode) =>
  (['member', 'staff'] as const).map((sessionType) => ({ mode, sessionType })),
);
for (const { mode, sessionType } of journeys) {
  const fixture = await accountDataRuntime(sessionType);
  try {
    const expired = await fixture.simulator.dispatchFetch(`${ACCOUNT_ORIGIN}/sign-in/staff-link/`, {
      redirect: 'manual',
    });
    assert.equal(expired.status, 410);
    const expiredHtml = await expired.text();
    assert.match(expiredHtml, /<html[^>]+lang="en"/);
    assert.match(expiredHtml, /<title>Connection expired/);
    assert.match(expiredHtml, /Open Staff Portal/);
    assert.doesNotMatch(expiredHtml, /action="\/sign-in\/staff-link\/"/);
    const env = { PLATFORM_DB: fixture.db, LVBT_SIGN_IN_SECRET: 'independent-staff-fixture-only' };
    const service = mode === 'google' ? new WorkspaceLinkService(env) : new SsoLinkService(env);
    const pending = await service.begin(
      {
        subject: 'handoff-google',
        issuer: 'https://fixture.cloudflareaccess.com',
        expiresAt: new Date(Date.now() + 3600000),
        email: 'handoff@lasvegasfortransit.org',
        givenName: null,
        familyName: null,
      },
      { returnTo: '/paper/' },
    );
    const token = await beginMemberHandoff(env, pending, {
      mode,
      staffOrigin: 'https://staff.lasvegasfortransit.org',
    });
    const url = `${ACCOUNT_ORIGIN}/sign-in/staff-link/?request=${token}`;
    const signedOut = await fixture.simulator.dispatchFetch(url, { redirect: 'manual' });
    assert.equal(signedOut.status, 303);
    assert.match(signedOut.headers.get('Location') ?? '', /^\/sign-in\/\?next=/);
    await signedOut.arrayBuffer();
    const ineligible = await createSession(
      { PLATFORM_DB: fixture.db, LVBT_SIGN_IN_SECRET: 'account-data-fixture-only' },
      fixture.other.id,
      sessionType,
    );
    const recovery = await fixture.simulator.dispatchFetch(url, {
      headers: { Cookie: `__Host-lvbt_session=${ineligible.token}` },
      redirect: 'manual',
    });
    assert.equal(
      recovery.status,
      409,
      'signed-in ineligible accounts must not loop through sign-in',
    );
    assert.match(await recovery.text(), /Connection unavailable/);
    const cookie = `__Host-lvbt_session=${fixture.session.token}`;
    const get = await fixture.simulator.dispatchFetch(url, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    assert.equal(
      get.status,
      200,
      `${mode}: existing ${sessionType} account session must reach confirmation`,
    );
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
    await approveHandoffInBrowser(fixture, url);
    assert.equal(await staffHandoffProof(env, token, { pending: 'wrong-browser', mode }), null);
    const proof = await staffHandoffProof(env, token, { pending, mode });
    assert.ok(proof);
    const verificationBefore = await fixture.db
      .prepare('SELECT email_verified_at FROM people WHERE id=?')
      .bind(fixture.person.id)
      .first<{ email_verified_at: string | null }>();
    const completed = await service.completeForMemberHandoff(pending, token);
    const verificationAfter = await fixture.db
      .prepare('SELECT email_verified_at FROM people WHERE id=?')
      .bind(fixture.person.id)
      .first<{ email_verified_at: string | null }>();
    assert.deepEqual(
      verificationAfter,
      verificationBefore,
      'account control must not invent personal-email verification',
    );
    assert.equal(completed.kind, 'ok');
    assert.equal(completed.personId, fixture.person.id);
    assert.notEqual((await service.completeForMemberHandoff(pending, token)).kind, 'ok');
    console.log(
      'Compiled member-site handoff: host-only member session, CSRF rejection, verified account display, portal-bound completion and replay refusal passed.',
    );
  } finally {
    await fixture.dispose();
  }
}
