import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import type { Browser, Page } from '@playwright/test';
import { measureRouteJavaScript } from '../../../scripts/audit/budgets';
import { ORIGIN } from '../../support/runtime';

export async function authenticatedContext(
  browser: Browser,
  identity: { assertion: string; session: { token: string } },
  javaScriptEnabled = true,
) {
  const context = await browser.newContext({
    javaScriptEnabled,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': identity.assertion },
  });
  await context.addCookies([
    {
      name: '__Host-lvbt_session',
      value: identity.session.token,
      url: ORIGIN,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await context.route('**/*', async (route) => {
    assert.equal(
      route.request().method(),
      'GET',
      'audits must not submit a staff action or request a code',
    );
    assert.equal(
      new URL(route.request().url()).origin,
      ORIGIN,
      'audit requests must stay in the synthetic local fixture',
    );
    await route.continue();
  });
  return context;
}

async function verifyPrintedSheet(page: Page) {
  const sheet = page.getByRole('region', { name: 'Printable signup sheet', exact: true });
  await page.locator('.staff-back').focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await sheet.evaluate((element) => element === document.activeElement),
    true,
    'the sheet must be reachable with Tab',
  );
  if (await sheet.evaluate((element) => element.scrollWidth > element.clientWidth)) {
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(
      () => {
        const element = document.querySelector('.staff-signup-sheet');
        return element !== null && element.scrollLeft > 0;
      },
      undefined,
      { timeout: 2000 },
    );
  }
  assert.equal(await page.locator('.staff-signup-checkbox[aria-hidden="true"]').count(), 12);
  assert.equal(
    await page.getByRole('checkbox').count(),
    0,
    'drawn print boxes must not pretend to be digital controls',
  );
  assert.equal(
    await page.getByRole('columnheader', { name: /Mailing-list signup\s+Yes/ }).count(),
    1,
    'the print column must retain its readable label',
  );
}

export async function auditPage(page: Page, path: string) {
  const response = await page.goto(`${ORIGIN}${path}`);
  assert.ok(response);
  assert.equal(response.status(), 200, `authenticated page ${path}`);
  assert.equal(page.url(), `${ORIGIN}${path}`, 'the audit must not follow a sign-in redirect');
  assert.equal(response.headers()['cache-control'], 'private, no-store');
  assert.equal(response.headers()['x-robots-tag'], 'noindex, nofollow');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  if (path === '/paper/sheet/') await verifyPrintedSheet(page);
  // Count declared scripts before axe injects its own analysis code. CSP-blocked code counts too.
  const declared = await page.evaluate(() => ({
    scripts: [...document.scripts]
      .filter(
        (script) =>
          !script.type ||
          /^(?:module|(?:text|application)\/(?:java|ecma)script)$/i.test(script.type),
      )
      .map((script) => (script.src ? { src: script.src } : { code: script.textContent })),
    modulePreloads: [
      ...document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]'),
    ].map((link) => link.href),
  }));
  const budget = await measureRouteJavaScript({
    url: page.url(),
    ...declared,
    // APIRequestContext uses Node DNS; browser fetch keeps the fixture's hostname mapping,
    // current cookies/Access assertion and GET-only origin guard on every imported module.
    load: (url) =>
      page.evaluate(async (src) => {
        const script = await fetch(src, { redirect: 'manual' });
        return { url: script.url, status: script.status, body: await script.text() };
      }, url),
  });
  // Disclosures are native HTML and contain controls that also need checking when visible.
  await page
    .locator('details')
    .evaluateAll((details) => details.forEach((detail) => detail.setAttribute('open', '')));
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  assert.deepEqual(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    })),
    [],
    `axe violations on ${path}`,
  );
  assert.equal(await page.locator('main').count(), 1);
  assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    `horizontal overflow on ${path}`,
  );
  return { path, ...budget, axeViolations: results.violations.length };
}
