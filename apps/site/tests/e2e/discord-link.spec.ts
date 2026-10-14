import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import {
  discordRuntime,
  DISCORD_USER,
  ORIGIN,
  DISCORD_ROLES,
} from '../runtime/support/discord-runtime';
const fixture = await discordRuntime();
const browser = await chromium
  .launch({
    args: [
      `--host-resolver-rules=MAP ${new URL(ORIGIN).hostname} 127.0.0.1:${fixture.port}, MAP discord.com 127.0.0.1:${fixture.authorization.port}, MAP * ~NOTFOUND`,
      '--no-proxy-server',
    ],
  })
  .catch(async (error: unknown) => {
    await fixture.dispose();
    throw error;
  });
try {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  await context.addCookies([
    {
      name: '__Host-lvbt_session',
      value: fixture.session.token,
      url: ORIGIN,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    assert.ok(
      [ORIGIN, 'https://discord.com'].includes(url.origin),
      'the browser fixture must make no real external requests',
    );
    await route.continue();
  });
  const page = await context.newPage();
  const shots = join(fixture.root, 'test-results/discord');
  await mkdir(shots, { recursive: true });
  await page.goto(`${ORIGIN}/account/`);
  await page
    .getByRole('navigation', { name: 'Account sections' })
    .getByRole('link', { name: 'Discord', exact: true })
    .waitFor({ timeout: 5000 });
  assert.deepEqual(
    await page
      .getByRole('navigation', { name: 'Account sections' })
      .getByRole('link')
      .allTextContents(),
    ['Details', 'Email', 'Discord', 'Data'],
  );
  await page.screenshot({
    path: join(shots, 'account-sections-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: join(shots, 'account-sections-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('navigation', { name: 'Account sections' })
    .getByRole('link', { name: 'Discord', exact: true })
    .click();
  await page.getByRole('heading', { name: 'Discord', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Join LVBT on Discord', exact: true }).click();
  await page.getByRole('heading', { name: 'Join LVBT on Discord', exact: true }).waitFor();
  await page.screenshot({
    path: join(shots, 'connect-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const token = await page.locator('input[name="token"]').inputValue();
  assert.ok(token);
  const wrongOrigin = await fixture.simulator.dispatchFetch(`${ORIGIN}/account/discord/`, {
    method: 'POST',
    headers: {
      Origin: 'https://attacker.example',
      Cookie: `__Host-lvbt_session=${fixture.session.token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ token }),
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(fixture.providerCalls.length, 0);
  const unsupportedSiteOrigin = await fixture.simulator.dispatchFetch(
    'https://preview.example/account/discord/',
    { headers: { Cookie: `__Host-lvbt_session=${fixture.session.token}` } },
  );
  assert.equal(unsupportedSiteOrigin.status, 403);
  assert.match(unsupportedSiteOrigin.headers.get('Content-Type') ?? '', /text\/html/);
  const unavailablePage = await unsupportedSiteOrigin.text();
  assert.match(unavailablePage, /<html[^>]*lang="en"/);
  assert.match(unavailablePage, /<title>Join LVBT on Discord/);
  assert.match(unavailablePage, /This connection is not available at this address\./);
  assert.doesNotMatch(unavailablePage, /Continue to Discord/);
  await page.getByRole('button', { name: 'Continue to Discord', exact: true }).click();
  await page.getByRole('link', { name: 'Cancel authorization', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/account/#discord`);
  await page.getByText("Discord wasn't connected.", { exact: true }).waitFor({ timeout: 5000 });
  assert.equal(fixture.providerCalls.length, 0);
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT count(*) AS n FROM identities WHERE platform='discord'")
        .first()
    )?.n,
    0,
  );
  await page.getByRole('link', { name: 'Join LVBT on Discord', exact: true }).click();
  fixture.scenario.failOAuth = true;
  await page.getByRole('button', { name: 'Continue to Discord', exact: true }).click();
  await page.getByRole('link', { name: 'Authorize fixture account', exact: true }).click();
  await page
    .getByText("We couldn't reach Discord. Try again in a few minutes.", { exact: true })
    .waitFor();
  assert.equal(fixture.providerCalls.length, 1);
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT count(*) AS n FROM identities WHERE platform='discord'")
        .first()
    )?.n,
    0,
  );
  fixture.scenario.failOAuth = false;
  const callsBeforeSuccess = fixture.providerCalls.length;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('link', { name: 'Authorize fixture account', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/account/#discord`);
  await page.getByText(`Connected as ${DISCORD_USER.username}.`, { exact: true }).waitFor();
  await page.getByText('You’re in LVBT’s Discord.', { exact: true }).waitFor();
  assert.equal(fixture.authorization.authorizations.length, 3);
  const authorized = fixture.authorization.authorizations[2];
  assert.ok(authorized);
  assert.equal(authorized.searchParams.get('scope'), 'identify guilds.join');
  assert.equal(authorized.searchParams.get('redirect_uri'), `${ORIGIN}/account/discord/callback`);
  assert.deepEqual(fixture.providerCalls.slice(callsBeforeSuccess), [
    'https://discord.com/api/v10/oauth2/token',
    'https://discord.com/api/v10/users/@me',
    'https://discord.com/api/v10/users/@me',
    'https://discord.com/api/v10/guilds/111111111111111111/members/222222222222222222',
  ]);
  assert.equal(fixture.scenario.joined, true);
  assert.deepEqual([...fixture.scenario.roles], [DISCORD_ROLES.unmanaged]);
  assert.equal((await fixture.jobs.scheduled({ cron: '* * * * *' })).outcome, 'ok');
  assert.deepEqual([...fixture.scenario.roles].sort(), Object.values(DISCORD_ROLES).sort());
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='access.granted'")
        .first()
    )?.n,
    3,
  );
  const providerCallCount = fixture.providerCalls.length;
  const identity = await fixture.db
    .prepare(
      "SELECT external_id,link_method FROM identities WHERE person_id=? AND platform='discord'",
    )
    .bind(fixture.person.id)
    .first<{ external_id: string; link_method: string }>();
  assert.deepEqual(identity, { external_id: DISCORD_USER.id, link_method: 'self_linked' });
  assert.equal((await fixture.people.getPerson(fixture.person.id))?.given_name, 'LVBT Member');
  await page.goto(
    `${ORIGIN}/account/discord/callback?state=${encodeURIComponent(authorized.searchParams.get('state') ?? '')}&code=fixture-code`,
  );
  await page.waitForURL(`${ORIGIN}/account/discord/?result=failed`);
  assert.equal(
    fixture.providerCalls.length,
    providerCallCount,
    'a repeated callback must not exchange another code',
  );
  fixture.scenario.pending = true;
  fixture.scenario.roles = new Set([DISCORD_ROLES.unmanaged]);
  await page.goto(`${ORIGIN}/account/discord/`);
  await page.getByRole('button', { name: 'Continue to Discord', exact: true }).click();
  await page.getByRole('link', { name: 'Authorize fixture account', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/account/discord/?result=screening_pending`);
  await page.getByRole('link', { name: 'Open Discord', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Continue', exact: true }).count(), 0);
  assert.equal((await fixture.jobs.scheduled({ cron: '* * * * *' })).outcome, 'ok');
  assert.deepEqual([...fixture.scenario.roles], [DISCORD_ROLES.unmanaged]);
  await page.screenshot({
    path: join(shots, 'screening-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });

  fixture.scenario.pending = false;
  fixture.scenario.failJoin = true;
  await page.goto(`${ORIGIN}/account/discord/`);
  await page.getByRole('button', { name: 'Continue to Discord', exact: true }).click();
  await page.getByRole('link', { name: 'Authorize fixture account', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/account/discord/?result=retry`);
  await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
  await page
    .getByText('We couldn’t finish joining LVBT’s Discord. Please try again.', { exact: true })
    .waitFor();
  fixture.scenario.failJoin = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('link', { name: 'Authorize fixture account', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/account/#discord`);
  assert.equal((await fixture.jobs.scheduled({ cron: '* * * * *' })).outcome, 'ok');
  assert.deepEqual([...fixture.scenario.roles].sort(), Object.values(DISCORD_ROLES).sort());
  await page.goto(`${ORIGIN}/account/`);
  await page.getByRole('link', { name: 'Disconnect Discord', exact: true }).click();
  await page.getByRole('heading', { name: 'Disconnect Discord', exact: true }).first().waitFor();
  await page.getByRole('link', { name: 'Keep connected', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/account/#discord`, { waitUntil: 'domcontentloaded' });
  assert.deepEqual([...fixture.scenario.roles].sort(), Object.values(DISCORD_ROLES).sort());
  await page.getByRole('link', { name: 'Disconnect Discord', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/account/discord/disconnect/`, { waitUntil: 'domcontentloaded' });
  const confirmation = await page.locator('input[name="token"]').inputValue();
  const refused = await fixture.simulator.dispatchFetch(`${ORIGIN}/account/discord/disconnect/`, {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example',
      Cookie: `__Host-lvbt_session=${fixture.session.token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ token: confirmation }).toString(),
    redirect: 'manual',
  });
  assert.equal(refused.status, 403);
  await page.screenshot({
    path: join(shots, 'disconnect-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Disconnect Discord', exact: true }).focus();
  fixture.scenario.failRoleWrites = true;
  await page.keyboard.press('Enter');
  await page
    .getByText('We couldn’t disconnect Discord just now. Please try again.', { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole('link', { name: 'Keep connected', exact: true }).count(),
    0,
    'a confirmed disconnect cannot offer a false cancellation',
  );
  await page.reload();
  await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
  fixture.scenario.failRoleWrites = false;
  await fixture.db
    .prepare(
      "UPDATE integration_outbox SET next_attempt_at=? WHERE json_extract(payload,'$.source')='discord_disconnect' AND state='retry'",
    )
    .bind(new Date().toISOString())
    .run();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  assert.equal(page.url(), `${ORIGIN}/account/#discord`);
  await page.getByText('Disconnecting Discord.', { exact: true }).waitFor();
  assert.equal((await fixture.jobs.scheduled({ cron: '* * * * *' })).outcome, 'ok');
  await page.reload();
  await page.getByRole('link', { name: 'Join LVBT on Discord', exact: true }).waitFor();
  assert.deepEqual([...fixture.scenario.roles], [DISCORD_ROLES.unmanaged]);
  assert.equal(fixture.scenario.joined, true, 'disconnect must not kick the member');
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT count(*) AS n FROM identities WHERE platform='discord'")
        .first()
    )?.n,
    0,
  );
  assert.equal((await fixture.people.getPerson(fixture.person.id))?.membership_status, 'member');
  const other = await fixture.people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'other-discord-owner@example.invalid' },
  });
  await fixture.people.linkIdentity(other.person.id, {
    platform: 'discord',
    externalId: DISCORD_USER.id,
    linkMethod: 'self_linked',
  });
  const callsBeforeConflict = fixture.providerCalls.length;
  await page.getByRole('link', { name: 'Join LVBT on Discord', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to Discord', exact: true }).click();
  await page.getByRole('link', { name: 'Authorize fixture account', exact: true }).click();
  await page
    .getByText('That Discord account is already connected to a different LVBT account.', {
      exact: false,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole('link', {
        name: "Contact hello@lasvegasfortransit.org if that's wrong.",
        exact: true,
      })
      .getAttribute('href'),
    'mailto:hello@lasvegasfortransit.org',
  );
  assert.deepEqual(fixture.providerCalls.slice(callsBeforeConflict), [
    'https://discord.com/api/v10/oauth2/token',
    'https://discord.com/api/v10/users/@me',
  ]);
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT person_id FROM identities WHERE platform='discord' AND external_id=?")
        .bind(DISCORD_USER.id)
        .first()
    )?.person_id,
    other.person.id,
  );
  await page.screenshot({
    path: join(shots, 'discord-conflict-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  // Remove only the disposable fixture link so this member can test a fresh authorization.
  await fixture.db
    .prepare("DELETE FROM identities WHERE platform='discord' AND external_id=? AND person_id=?")
    .bind(DISCORD_USER.id, other.person.id)
    .run();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('link', { name: 'Authorize fixture account', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/account/#discord`);
  await fixture.people.withdrawConsent(fixture.person.id, {
    scope: 'newsletter',
    source: 'member',
    withdrawnAt: new Date().toISOString(),
  });
  await page.goto(`${ORIGIN}/account/`);
  assert.equal(
    await page.getByRole('link', { name: 'Disconnect Discord', exact: true }).count(),
    1,
    'former members can still disconnect a personal account',
  );
  const former = await page.goto(`${ORIGIN}/account/discord/`);
  assert.equal(former?.status(), 409);
  assert.equal(
    await page.getByRole('button', { name: 'Continue to Discord', exact: true }).count(),
    0,
  );
  await page.goto(`${ORIGIN}/account/`);
  await page.getByRole('link', { name: 'Disconnect Discord', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect Discord', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/account/#discord`);
  assert.equal(
    await page
      .getByRole('navigation', { name: 'Account sections' })
      .getByRole('link', { name: 'Discord', exact: true })
      .count(),
    0,
    'an unavailable section leaves no visible navigation link',
  );
  const expired = await fixture.simulator.dispatchFetch(`${ORIGIN}/account/discord/`, {
    redirect: 'manual',
  });
  assert.equal(expired.status, 303);
  console.log(
    JSON.stringify({
      runtime: 'compiled website Worker',
      javaScript: false,
      provider: 'isolated OAuth fixture',
      checks: [
        'native connection with callback cookie and saved identity',
        'strict start origin',
        'one-use callback',
        'withdrawn member denied',
        'signed-out member redirected',
      ],
      screenshots: shots,
    }),
  );
  await context.close();
} finally {
  await browser.close();
  await fixture.dispose();
}
