import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { ORIGIN, type startRuntime } from '../../support/runtime';
export async function exerciseProviderHistory(
  fixture: Awaited<ReturnType<typeof startRuntime>>,
  personId: string,
): Promise<void> {
  const browser = await chromium.launch({
    args: [
      `--host-resolver-rules=MAP staff.lasvegasfortransit.org 127.0.0.1:${fixture.port}`,
      '--no-proxy-server',
    ],
  });
  try {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': fixture.admin.assertion },
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: 'block',
    });
    await context.addCookies([
      {
        name: '__Host-lvbt_session',
        value: fixture.admin.session.token,
        url: ORIGIN,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
    await context.route('**/*', async (route) => {
      assert.equal(new URL(route.request().url()).origin, ORIGIN);
      await route.continue();
    });
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/access/?person=${personId}`);
    assert.equal(await page.getByRole('heading', { name: 'New Member', exact: true }).count(), 1);
    assert.equal(new URL(page.url()).pathname, `/people/${personId}/`);
    const current = page.getByRole('region', { name: 'Accounts', exact: true });
    if ((await current.locator('details').first().getAttribute('open')) === null)
      await current.locator('summary').first().click();
    assert.equal(await current.getByRole('heading', { name: 'Discord', exact: true }).count(), 1);
    assert.equal(await current.getByText('No access', { exact: true }).isVisible(), true);
    assert.equal(await current.getByText('Discord access granted', { exact: true }).count(), 0);
    assert.equal(
      await page.locator('.staff-account-history').count(),
      0,
      'troubleshooting logs are absent from member profiles',
    );
    const shots = join(fixture.root, 'test-results/staff');
    await mkdir(shots, { recursive: true });
    for (const [name, width] of [
      ['desktop', 1440],
      ['mobile', 320],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({
        animations: 'disabled',
        fullPage: true,
        path: join(shots, `access-current-${name}.png`),
      });
    }
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({
      animations: 'disabled',
      fullPage: true,
      path: join(shots, 'access-current-dark.png'),
    });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`${ORIGIN}/access/?view=all`);
    await page.locator('.staff-account-history > summary').click();

    assert.equal(await page.getByText('Discord access granted', { exact: true }).isVisible(), true);
    assert.equal(await page.getByText('Discord access removed', { exact: true }).isVisible(), true);
    assert.equal(
      await page
        .locator('.staff-account-history .staff-history-reason')
        .getByText('Membership changed', { exact: true })
        .isVisible(),
      true,
    );
    const attribution = await page
      .locator('.staff-account-history .staff-account-history-list')
      .innerText();
    assert.match(attribution, /By LVBT/);
    assert.doesNotMatch(attribution, /Automatic Discord update|Automatic Google update/);
    for (const [name, width] of [
      ['desktop', 1440],
      ['mobile', 320],
    ] as const) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
      await page.screenshot({
        animations: 'disabled',
        fullPage: true,
        path: join(shots, `access-confirmed-${name}.png`),
      });
    }
    const pastEnd = Buffer.from(JSON.stringify(['zzzz', 'zzzz'])).toString('base64url');
    await page.goto(`${ORIGIN}/access/?person=${personId}&cursor=${pastEnd}`);
    assert.equal(await page.getByRole('heading', { name: 'New Member', exact: true }).count(), 1);
    const pagedAccounts = page.getByRole('region', { name: 'Accounts', exact: true });
    if ((await pagedAccounts.locator('details').first().getAttribute('open')) === null)
      await pagedAccounts.locator('summary').first().click();
    assert.equal(await page.getByRole('heading', { name: 'Discord', exact: true }).count(), 1);
    await page.goto(`${ORIGIN}/people/${personId}/`);
    const facts = page.getByRole('region', { name: 'Member summary', exact: true });
    assert.equal(await facts.getByText('Former member', { exact: true }).isVisible(), true);
    assert.equal(await facts.getByText(/^Unsubscribed from LVBT updates /).isVisible(), true);
    assert.equal(await page.getByText('Access history', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Discord access granted', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Discord access removed', { exact: true }).count(), 0);
  } finally {
    await browser.close();
  }
}
