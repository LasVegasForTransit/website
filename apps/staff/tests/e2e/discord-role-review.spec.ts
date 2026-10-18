import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import { issueFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { ORIGIN, startRuntime } from '../support/runtime';

const guildId = '111111111111111111';
const memberRoleId = '333333333333333333';
const eventsRoleId = '444444444444444444';
const advocacyRoleId = '555555555555555555';
const firstAccount = '700000000000000001';
const secondAccount = '700000000000000002';
const timestamp = '2026-10-12T10:00:00.000Z';

const fixture = await startRuntime({ discord: true });
const browser = await chromium.launch({
  args: [
    `--host-resolver-rules=MAP staff.lasvegasfortransit.org 127.0.0.1:${fixture.port}`,
    '--no-proxy-server',
  ],
});

try {
  await fixture.db
    .prepare(
      "INSERT INTO committee_account_mappings(committee_id,provider,external_id,recorded_at) VALUES('events','discord',?,?),('advocacy','discord',?,?)",
    )
    .bind(eventsRoleId, timestamp, advocacyRoleId, timestamp)
    .run();
  await fixture.db
    .prepare(
      'INSERT INTO discord_role_reviews(guild_id,discord_user_id,managed_role_ids,first_seen_at,last_seen_at,last_seen_scan_id) VALUES(?,?,?,?,?,?),(?,?,?,?,?,?)',
    )
    .bind(
      guildId,
      firstAccount,
      JSON.stringify([memberRoleId, eventsRoleId, advocacyRoleId]),
      timestamp,
      timestamp,
      timestamp,
      guildId,
      secondAccount,
      JSON.stringify([advocacyRoleId]),
      timestamp,
      timestamp,
      timestamp,
    )
    .run();

  await fixture.db
    .prepare('UPDATE discord_role_reviews SET username=?,nickname=? WHERE discord_user_id=?')
    .bind('a'.repeat(32), 'W'.repeat(32), firstAccount)
    .run();

  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': fixture.admin.assertion },
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
  });
  const setSession = async (kind: 'admin' | 'lead') => {
    await context.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': fixture[kind].assertion });
    await context.clearCookies();
    await context.addCookies([
      {
        name: '__Host-lvbt_session',
        value: fixture[kind].session.token,
        url: ORIGIN,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
  };
  await setSession('admin');
  await context.route('**/*', async (route) => {
    assert.equal(new URL(route.request().url()).origin, ORIGIN);
    await route.continue();
  });
  const page = await context.newPage();
  const response = await page.goto(`${ORIGIN}/access/`);
  const pageBody = await page.locator('body').innerText();
  const reviewSection = page.locator('.staff-discord-review');
  assert.equal(response?.status(), 200, pageBody);
  assert.equal(pageBody.includes('Discord accounts to check'), true, pageBody);
  assert.equal(pageBody.includes('No access updates need a retry.'), true, pageBody);
  assert.equal(
    await reviewSection
      .getByText('LVBT Member, Advocacy Team, Events Committee', { exact: true })
      .count(),
    1,
  );
  assert.equal(await reviewSection.getByText('Advocacy Team', { exact: true }).count(), 1);
  assert.equal(pageBody.includes(firstAccount), false, 'raw Discord IDs stay out of staff copy');
  assert.equal(pageBody.includes(secondAccount), false, 'raw Discord IDs stay out of staff copy');
  assert.equal(await reviewSection.getByText(/^Added to this list /).count(), 2);
  assert.equal(
    await reviewSection
      .getByText(
        'We couldn’t match these accounts to a member record. Their access stays as it is while staff checks.',
        { exact: true },
      )
      .count(),
    1,
  );
  const openDiscord = reviewSection
    .locator('li')
    .first()
    .getByRole('link', {
      name: `Open Discord profile for @${'a'.repeat(32)}`,
      exact: true,
    });
  assert.equal(await openDiscord.innerText(), 'Open in Discord');
  assert.equal(await openDiscord.getAttribute('href'), `https://discord.com/users/${firstAccount}`);
  assert.equal(
    (await openDiscord.getAttribute('class'))?.split(' ').includes('staff-action-link'),
    true,
  );
  assert.equal(
    await openDiscord.evaluate((element) => getComputedStyle(element).minHeight),
    '44px',
  );
  const showAllAccess = page.getByRole('link', { name: 'All access', exact: true });
  assert.equal(await showAllAccess.getAttribute('href'), '/access/?view=all');
  assert.equal(
    await showAllAccess.evaluate((element) => getComputedStyle(element).minHeight),
    '44px',
  );
  for (let tab = 0; tab < 30; tab++) {
    if (await openDiscord.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  assert.equal(await openDiscord.evaluate((element) => element.matches(':focus-visible')), true);
  assert.equal(
    await openDiscord.evaluate((element) => getComputedStyle(element).outlineWidth),
    '3px',
  );

  await mkdir(join(fixture.root, 'test-results/staff'), { recursive: true });
  await page.screenshot({
    animations: 'disabled',
    path: join(fixture.root, 'test-results/staff/discord-review-desktop.png'),
  });
  const lightSurface = await page
    .locator('.staff-discord-review')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.emulateMedia({ colorScheme: 'dark' });
  const darkSurface = await page
    .locator('.staff-discord-review')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.notEqual(darkSurface, lightSurface);
  await page.screenshot({
    animations: 'disabled',
    path: join(fixture.root, 'test-results/staff/discord-review-dark.png'),
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: join(fixture.root, 'test-results/staff/discord-review-mobile.png'),
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'the access page must fit at 320px with long provider names and enlarged text',
  );
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });

  await setSession('lead');
  const leadHeaders = {
    'Cf-Access-Jwt-Assertion': fixture.lead.assertion,
    Cookie: `__Host-lvbt_session=${fixture.lead.session.token}`,
  };
  const lead = await loadActor(fixture.db, fixture.lead.person.id);
  assert.ok(lead);
  const token = await issueFormToken(fixture.db, lead, 'access:retry:denied-overview-target');
  const tokenHash = await digestToken(token);
  for (const path of [
    '/access/',
    '/access/?view=all',
    '/access/?committee=events',
    '/access/?q=Committee',
  ]) {
    for (const method of ['GET', 'POST']) {
      const denied = await fixture.simulator.dispatchFetch(`${ORIGIN}${path}`, {
        method,
        headers: { ...leadHeaders, ...(method === 'POST' ? { Origin: ORIGIN } : {}) },
        ...(method === 'POST'
          ? {
              body: new URLSearchParams({
                action: 'retry',
                target: 'denied-overview-target',
                token,
              }),
            }
          : {}),
      });
      const deniedBody = await denied.text();
      assert.equal(denied.status, 403, `${method} ${path}: ${deniedBody}`);
      assert.equal(
        /Discord accounts to check|Committee Rider|Advocacy Team|rider\d+@/.test(deniedBody),
        false,
      );
      assert.equal(deniedBody.includes(firstAccount) || deniedBody.includes(secondAccount), false);
    }
  }
  const postedPerson = await fixture.simulator.dispatchFetch(
    `${ORIGIN}/access/?person=${fixture.inside.id}`,
    {
      method: 'POST',
      headers: { ...leadHeaders, Origin: ORIGIN },
      body: new URLSearchParams({ action: 'retry', target: 'denied-overview-target', token }),
    },
  );
  assert.equal(postedPerson.status, 403);
  await postedPerson.arrayBuffer();
  assert.ok(
    await fixture.db
      .prepare('SELECT 1 FROM staff_form_tokens WHERE token_hash=?')
      .bind(tokenHash)
      .first(),
    'denied overview submissions must not consume a valid scoped form token',
  );
  const legacy = await fixture.simulator.dispatchFetch(
    `${ORIGIN}/access/?person=${fixture.inside.id}`,
    {
      headers: leadHeaders,
      redirect: 'manual',
    },
  );
  assert.equal(legacy.status, 303);
  assert.equal(legacy.headers.get('Location'), `/people/${fixture.inside.id}/#accounts`);
  await legacy.arrayBuffer();
  assert.equal((await page.goto(`${ORIGIN}/people/${fixture.inside.id}/`))?.status(), 200);
  assert.equal((await page.goto(`${ORIGIN}/people/`))?.status(), 200);
  assert.equal(await page.locator('a[href="/access/"]').count(), 0);
  await context.close();
  console.log(
    JSON.stringify({
      runtime: 'compiled staff Worker',
      javaScript: false,
      checks: [
        'admin sees every unlinked role holder and managed role name',
        'committee leads cannot read or post the access overview through filters',
        'denied overview submissions preserve scoped form tokens and reveal no account data',
        'legacy member links redirect to scoped profiles and lead roster hides the overview link',
        'review actions render as recognizable buttons on desktop and mobile',
        'mobile layout has no horizontal overflow',
      ],
      screenshots: join(fixture.root, 'test-results/staff'),
    }),
  );
} finally {
  await browser.close();
  await fixture.dispose();
}
