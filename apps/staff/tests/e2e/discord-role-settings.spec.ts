import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { Response as RuntimeResponse } from 'miniflare';
import { ORIGIN, startRuntime } from '../support/runtime';
const guildId = '111111111111111111',
  botId = '222222222222222222',
  memberId = '333333333333333333',
  botRole = '444444444444444444',
  appId = '555555555555555555',
  eventsId = '666666666666666666',
  leadId = '777777777777777777',
  managedId = '888888888888888888';
const role = (
  id: string,
  name: string,
  position: number,
  extra: { managed?: boolean; permissions?: string } = {},
) => ({
  id,
  name,
  position,
  managed: extra.managed ?? false,
  permissions: extra.permissions ?? '0',
});
const roles = [
  role(guildId, '@everyone', 0),
  role(botRole, 'LVBT Bot', 10, { managed: true, permissions: '268435457' }),
  role(memberId, 'LVBT Member', 1),
  role(eventsId, 'Events', 2),
  role(leadId, 'Events leads', 3),
  role(managedId, 'Connected app', 4, { managed: true }),
];
let providerReads = 0;
function fetchRoles(request: Request) {
  assert.equal(request.method, 'GET', 'settings must never change provider state');
  assert.equal(request.headers.get('Authorization'), 'Bot fixture-token-jobs-only');
  providerReads++;
  const path = new URL(request.url).pathname;
  const value = path.endsWith('/applications/@me')
    ? { id: appId }
    : path.endsWith('/users/@me')
      ? { id: botId, bot: true }
      : path.endsWith(`/members/${botId}`)
        ? { user: { id: botId, bot: true }, roles: [botRole] }
        : path.endsWith('/roles')
          ? roles
          : null;
  assert.ok(value, `unexpected provider read ${path}`);
  return new RuntimeResponse(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });
}
async function save(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/committees/'),
    ),
    page.getByRole('button', { name: 'Save committee', exact: true }).click(),
  ]);
  await page.waitForLoadState('load');
  return response;
}
async function exercise(enabled: boolean) {
  const before = providerReads;
  const fixture = await startRuntime({ discordRoles: { enabled, fetch: fetchRoles } });
  const browser = await chromium.launch({
    args: [
      `--host-resolver-rules=MAP staff.lasvegasfortransit.org 127.0.0.1:${fixture.port}`,
      '--no-proxy-server',
    ],
  });
  try {
    if (!enabled)
      await fixture.db
        .prepare("UPDATE committees SET discord_role_id=?,discord_lead_role_id=? WHERE id='events'")
        .bind(eventsId, leadId)
        .run();
    const context = await browser.newContext({
      javaScriptEnabled: false,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': fixture.admin.assertion },
      viewport: { width: 320, height: 900 },
      serviceWorkers: 'block',
    });
    await context.addCookies([
      {
        name: '__Host-lvbt_session',
        value: fixture.admin.session.token,
        url: ORIGIN,
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();
    assert.equal((await page.goto(`${ORIGIN}/committees/events/settings/`))?.status(), 200);
    await page.getByText('Account connections', { exact: true }).click();
    const committee = page.getByLabel('Committee Discord role', { exact: true }),
      lead = page.getByLabel('Lead Discord role (optional)', { exact: true });
    assert.equal(await committee.isDisabled(), !enabled);
    assert.equal(await lead.isDisabled(), !enabled);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    if (!enabled) {
      assert.equal(
        await committee.locator('option:checked').innerText(),
        'Current connection kept',
      );
      await page
        .getByLabel('Description', { exact: true })
        .fill('Keep existing accounts while updating these details.');
      assert.equal((await save(page)).status(), 303);
      assert.deepEqual(
        await fixture.db
          .prepare("SELECT discord_role_id,discord_lead_role_id FROM committees WHERE id='events'")
          .first(),
        { discord_role_id: eventsId, discord_lead_role_id: leadId },
      );
      assert.equal(providerReads, before, 'disabled settings make no Discord requests');
      return;
    }
    assert.equal(
      await committee
        .locator('option')
        .allTextContents()
        .then((x) => x.join('|')),
      'No committee role|Events|Events leads',
    );
    assert.ok(!/\d{17,20}|fixture-token/.test(await page.locator('body').innerText()));
    const bounds = await committee.boundingBox();
    assert.ok(bounds);
    assert.ok(bounds.height >= 44);
    await committee.focus();
    assert.equal(await committee.evaluate((e) => e.matches(':focus-visible')), true);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    assert.equal(await lead.evaluate((e) => e === document.activeElement), true);
    await committee.selectOption(eventsId);
    await lead.selectOption(leadId);
    const screenshots = join(fixture.root, 'test-results/staff');
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({
      path: join(screenshots, 'committee-connections-mobile.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: join(screenshots, 'committee-connections-desktop.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({
      path: join(screenshots, 'committee-connections-dark.png'),
      fullPage: true,
      animations: 'disabled',
    });
    const leadRole = roles.find((r) => r.id === leadId);
    assert.ok(leadRole);
    leadRole.position = 11;
    assert.equal((await save(page)).status(), 400, 'hierarchy is checked again on save');
    assert.equal(
      (
        await fixture.db
          .prepare("SELECT settings_version FROM committees WHERE id='events'")
          .first<{ settings_version: number }>()
      )?.settings_version,
      1,
    );
    leadRole.position = 3;
    await page.goto(`${ORIGIN}/committees/events/settings/`);
    await page.getByText('Account connections', { exact: true }).click();
    await committee.selectOption(eventsId);
    await lead.selectOption(leadId);
    assert.equal((await save(page)).status(), 303);
    assert.deepEqual(
      await fixture.db
        .prepare("SELECT discord_role_id,discord_lead_role_id FROM committees WHERE id='events'")
        .first(),
      { discord_role_id: eventsId, discord_lead_role_id: leadId },
    );
    await context.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': fixture.lead.assertion });
    await context.clearCookies();
    await context.addCookies([
      {
        name: '__Host-lvbt_session',
        value: fixture.lead.session.token,
        url: ORIGIN,
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const reads = providerReads;
    assert.equal((await page.goto(`${ORIGIN}/committees/events/settings/`))?.status(), 404);
    const denied = await fixture.simulator.dispatchFetch(`${ORIGIN}/committees/events/settings/`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Cf-Access-Jwt-Assertion': fixture.lead.assertion,
        Cookie: `__Host-lvbt_session=${fixture.lead.session.token}`,
      },
      body: new URLSearchParams({ discord_role_id: memberId }),
    });
    assert.equal(denied.status, 404);
    await denied.arrayBuffer();
    assert.equal(providerReads, reads, 'denied staff never receive server role choices');
    await context.close();
  } finally {
    await browser.close();
    await fixture.dispose();
  }
}
await exercise(true);
await exercise(false);
console.log(
  JSON.stringify({
    runtime: 'compiled staff and jobs Workers',
    javaScript: false,
    checks: [
      'real private role catalog',
      'current hierarchy validated again on save',
      'optional lead role',
      'native keyboard and mobile controls',
      'administrator-only settings',
      'disabled configuration preserves connections without provider calls',
    ],
  }),
);
