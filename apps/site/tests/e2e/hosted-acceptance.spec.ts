import { expect, test } from '../../scripts/deploy/access-browser';
import { isProviderSpeculationResponse } from '../../scripts/deploy/hosted-preview-protection';
import {
  boundHostedBrowserRequests,
  createHostedRequestBudget,
} from '../../scripts/deploy/hosted-request-budget';

test('serves the selected release with working assets, navigation and missing-page recovery', async ({
  page,
  context,
  baseURL,
  accessRequest,
}, testInfo) => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, 'Hosted acceptance needs a selected release URL.');
  if (!baseURL) throw new Error('Hosted acceptance requires a baseURL.');
  const origin = new URL(baseURL).origin;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
  const preview = !local && new URL(origin).hostname !== 'lasvegasfortransit.org';
  const budget = createHostedRequestBudget();
  const failures: string[] = [];
  const assetTypes = new Set<string>();
  page.on('response', (response) => {
    if (new URL(response.url()).origin !== origin) return;
    const kind = response.request().resourceType();
    if (response.ok()) assetTypes.add(kind);
    else if (kind !== 'document') failures.push(`${kind}: ${response.status()}`);
    const checkPreviewProtection = preview && !isProviderSpeculationResponse(response);
    if (checkPreviewProtection && response.headers()['cache-control'] !== 'private, no-store')
      failures.push(`${kind}: preview cache protection missing`);
    if (checkPreviewProtection && !response.headers()['x-robots-tag']?.includes('noindex'))
      failures.push(`${kind}: preview indexing protection missing`);
  });
  await boundHostedBrowserRequests(context, accessRequest, budget, {
    failures,
    allowedMethods: !preview && !local ? ['GET', 'POST', 'OPTIONS'] : ['GET'],
  });
  try {
    // APIRequestContext bypasses browser routing; reserve its one non-redirecting request.
    expect(budget.claim()).toBe(true);
    const marker = await accessRequest.get('/lvbt-release.json', {
      maxRedirects: 0,
      maxRetries: 0,
    });
    expect(marker.status()).toBe(200);
    if (preview) {
      expect(marker.headers()['cache-control']).toBe('private, no-store');
      expect(marker.headers()['x-robots-tag']).toContain('noindex');
    }
    const identity = (await marker.json()) as { commit: string; releaseId: string };
    expect(identity.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(identity.releaseId).toMatch(/^[1-9][0-9]*$/);
    if (process.env.RELEASE_COMMIT) expect(identity.commit).toBe(process.env.RELEASE_COMMIT);
    if (process.env.RELEASE_ID) expect(identity.releaseId).toBe(process.env.RELEASE_ID);

    const home = await page.goto('/', { waitUntil: 'networkidle' });
    expect(home?.status()).toBe(200);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('font-family', /Public Sans/);
    for (const kind of ['stylesheet', 'script', 'font', 'image'])
      expect(assetTypes.has(kind)).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    const menu = page.locator('[data-nav-toggle]');
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await page
      .locator('[data-nav-overlay]')
      .getByRole('link', { name: 'About', exact: true })
      .click();
    await page.waitForURL('**/about/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main h1')).toBeVisible();
    expect(new URL(page.url()).origin).toBe(origin);

    const missing = await page.goto('/hosted-acceptance-missing/', { waitUntil: 'networkidle' });
    expect(missing?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Missed the stop?' })).toBeVisible();
    await expect(page.locator('[data-site-search-input]')).toBeVisible();
    expect(failures).toEqual([]);
  } finally {
    await page.close();
    await context.unrouteAll({ behavior: 'wait' });
    const report = budget.report();
    process.stdout.write(
      `Hosted acceptance requests: ${report.sent}/${report.limit}; ${report.blocked} blocked.\n`,
    );
    await testInfo.attach('hosted-request-budget', {
      body: JSON.stringify(report),
      contentType: 'application/json',
    });
    expect(report.blocked, `Hosted acceptance exceeded its ${report.limit}-request ceiling.`).toBe(
      0,
    );
  }
});
