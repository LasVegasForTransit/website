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
    await page.getByText('Access change history', { exact: true }).click();
    assert.equal(await page.getByText('Discord access granted', { exact: true }).isVisible(), true);
    assert.equal(await page.getByText('Discord access removed', { exact: true }).isVisible(), true);
    assert.equal(await page.getByText('Membership changed', { exact: false }).isVisible(), true);
    const shots = join(fixture.root, 'test-results/staff');
    await mkdir(shots, { recursive: true });
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
    await page.goto(`${ORIGIN}/people/${personId}/`);
    await page.getByText('Access history', { exact: true }).click();
    assert.equal(await page.getByText('Discord access granted', { exact: true }).isVisible(), true);
    assert.equal(await page.getByText('Discord access removed', { exact: true }).isVisible(), true);
  } finally {
    await browser.close();
  }
}
