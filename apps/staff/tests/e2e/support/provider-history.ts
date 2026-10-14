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
    assert.equal(
      await page.getByRole('heading', { name: 'Member channels', exact: true }).count(),
      1,
    );
    assert.equal(await page.getByText('No member access', { exact: true }).isVisible(), true);
    assert.equal(await page.locator('.staff-account-history').getAttribute('open'), null);
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
    const disclosure = page.getByText('Recent changes', { exact: true });
    for (let tab = 0; tab < 15; tab++) {
      if (await disclosure.evaluate((element) => element === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    assert.equal(await disclosure.evaluate((element) => element.matches(':focus-visible')), true);
    await page.keyboard.press('Enter');

    assert.equal(await page.getByText('Discord access granted', { exact: true }).isVisible(), true);
    assert.equal(await page.getByText('Discord access removed', { exact: true }).isVisible(), true);
    assert.equal(await page.getByText('Membership changed', { exact: false }).isVisible(), true);
    const attribution = await page.locator('.staff-account-history-list').innerText();
    assert.match(attribution, / · LVBT(?: ·|$)/m);
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
    assert.equal(
      await page.getByRole('heading', { name: 'Member channels', exact: true }).count(),
      1,
    );
    await page.goto(`${ORIGIN}/people/${personId}/`);
    await page.getByText('Access history', { exact: true }).click();
    assert.equal(await page.getByText('Discord access granted', { exact: true }).isVisible(), true);
    assert.equal(await page.getByText('Discord access removed', { exact: true }).isVisible(), true);
  } finally {
    await browser.close();
  }
}
