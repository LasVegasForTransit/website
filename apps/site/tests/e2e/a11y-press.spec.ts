import { expect, test } from '@playwright/test';

test('publishes the LVBT press page and makes it reachable from About and the footer', async ({
  page,
  request,
}) => {
  const browserRequests: URL[] = [];
  page.on('request', (request) => browserRequests.push(new URL(request.url())));
  await page.goto('/press');
  await page.waitForLoadState('networkidle');

  await expect(page.locator('h1')).toHaveText('LVBT in the press');
  await expect(page.getByRole('heading', { name: 'Coverage' })).toHaveCount(0);
  const archive = page.getByRole('region', { name: 'Press coverage' }).getByRole('list');
  await expect(archive).toBeVisible();
  await expect(
    archive.getByText('Press coverage could not be loaded right now. Please check back soon.'),
  ).toBeVisible();
  expect(browserRequests.some(({ hostname }) => hostname === 'api.notion.com')).toBe(false);
  expect(browserRequests.some(({ pathname }) => pathname === '/__lvbt/press-entries.json')).toBe(
    false,
  );
  await expect(
    page.getByRole('link', { name: 'press@lasvegasfortransit.org', exact: true }),
  ).toHaveAttribute('href', 'mailto:press@lasvegasfortransit.org');

  await page.goto('/about');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main a[href="/press"]')).toBeVisible();
  await expect(page.locator('footer a[href="/press"]')).toBeVisible();

  const sitemap = await request.get('/sitemap-0.xml');
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain('<loc>https://lasvegasfortransit.org/press/</loc>');
});
