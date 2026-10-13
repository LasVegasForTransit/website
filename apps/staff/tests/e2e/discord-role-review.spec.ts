import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
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
  assert.equal(
    pageBody.includes(
      'No updates need another try right now. This doesn’t confirm that members can sign in to Google Workspace or Discord.',
    ),
    true,
    pageBody,
  );
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
        'We couldn’t match these accounts to a member record. Their Discord roles stay as they are while staff checks.',
        { exact: true },
      )
      .count(),
    1,
  );
  const openDiscord = reviewSection.locator('li').first().getByRole('link', {
    name: 'Open Discord profile',
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
  const showAllAccess = page.getByRole('link', { name: 'Show all access updates', exact: true });
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

  await setSession('lead');
  await page.goto(`${ORIGIN}/access/`);
  await page.getByRole('heading', { name: 'Discord accounts to check' }).waitFor();
  assert.equal(await reviewSection.getByText('Events Committee', { exact: true }).count(), 1);
  assert.equal(await reviewSection.getByRole('link', { name: 'Open Discord profile' }).count(), 1);
  assert.equal(await reviewSection.getByText('Advocacy Team', { exact: true }).count(), 0);
  await context.close();
  console.log(
    JSON.stringify({
      runtime: 'compiled staff Worker',
      javaScript: false,
      checks: [
        'admin sees every unlinked role holder and managed role name',
        'committee lead sees only accounts with their committee role',
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
