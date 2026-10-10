import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { discordRuntime, DISCORD_USER, ORIGIN } from '../runtime/support/discord-runtime';
const fixture = await discordRuntime();
const browser = await chromium
  .launch({
    args: [
      `--host-resolver-rules=MAP lasvegasfortransit.org 127.0.0.1:${fixture.port}, MAP discord.com 127.0.0.1:${fixture.authorization.port}, MAP * ~NOTFOUND`,
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
  await page.goto(`${ORIGIN}/account/`);
  await page.getByRole('link', { name: 'Connect Discord', exact: true }).click();
  await page.getByRole('heading', { name: 'Connect Discord', exact: true }).waitFor();
  const shots = join(fixture.root, 'test-results/discord');
  await mkdir(shots, { recursive: true });
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
  await page.getByRole('button', { name: 'Continue to Discord', exact: true }).click();
  await page.getByRole('link', { name: 'Authorize fixture account', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/account/#discord`);
  await page.getByText(`Connected as ${DISCORD_USER.username}.`, { exact: true }).waitFor();
  assert.equal(fixture.authorization.authorizations.length, 1);
  const authorized = fixture.authorization.authorizations[0];
  assert.ok(authorized);
  assert.equal(authorized.searchParams.get('scope'), 'identify');
  assert.equal(authorized.searchParams.get('redirect_uri'), `${ORIGIN}/account/discord/callback`);
  assert.deepEqual(fixture.providerCalls, [
    'https://discord.com/api/v10/oauth2/token',
    'https://discord.com/api/v10/users/@me',
  ]);
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
    2,
    'a repeated callback must not exchange another code',
  );
  await fixture.people.withdrawConsent(fixture.person.id, {
    scope: 'newsletter',
    source: 'member',
    withdrawnAt: new Date().toISOString(),
  });
  const former = await page.goto(`${ORIGIN}/account/discord/`);
  assert.equal(former?.status(), 409);
  assert.equal(
    await page.getByRole('button', { name: 'Continue to Discord', exact: true }).count(),
    0,
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
