import { expect, test } from '@playwright/test';

test.describe('not found search recovery', () => {
  test('serves a transit-flavored not found page for missing routes', async ({ page }) => {
    const response = await page.goto('/totally-missing-seo-audit-test/');
    await page.waitForLoadState('networkidle');

    expect(response?.status()).toBe(404);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex,nofollow',
    );
    await expect(page.locator('h1')).toHaveText('Missed the stop?');
    await expect(page.locator('main')).toContainText('This route is not on the map');
    await expect(page.locator('[data-not-found-page]')).toHaveCSS(
      'background-color',
      'rgb(255, 233, 214)',
    );
    await expect(page.locator('[data-site-search]')).toBeVisible();
    await expect(page.locator('[data-site-search] h2')).toHaveCount(0);
    await expect(page.locator('[data-site-search-input]')).toBeVisible();
    await expect(page.locator('[data-site-search-status]')).toBeEmpty();
    await expect(page.locator('[aria-label="Lost route details"]')).toHaveCount(0);
    await expect(page.locator('[aria-label="Helpful pages"]')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Better frequency pending');
    await expect(page.locator('main')).not.toContainText('blaming the land use');
    await expect(page.locator('main a[href="/events"]')).toBeVisible();
    await expect(page.locator('main a[href="/go"]')).toBeVisible();
    await expect(page.locator('main a[href="/sitemap"]')).toHaveCount(0);
  });

  test('keeps the not found scene immersive through the main viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto('/totally-missing-seo-audit-test/');
    await page.waitForLoadState('networkidle');

    const coverage = await page.evaluate(() => {
      const main = document.querySelector('main');
      const scene = document.querySelector('[data-not-found-page]');
      const footer = document.querySelector('footer');
      if (!main || !scene || !footer) throw new Error('Missing 404 layout element');

      const mainBox = main.getBoundingClientRect();
      const sceneBox = scene.getBoundingClientRect();
      const footerBox = footer.getBoundingClientRect();
      const sampleY = Math.max(sceneBox.bottom - 2, mainBox.bottom - 2);
      const sampleElement = document.elementFromPoint(window.innerWidth / 2, sampleY);

      return {
        mainBottom: Math.round(mainBox.bottom),
        sceneBottom: Math.round(sceneBox.bottom),
        footerTop: Math.round(footerBox.top),
        sampledPrimaryScene: sampleElement?.closest('[data-not-found-page]') !== null,
      };
    });

    expect(coverage.sceneBottom).toBeGreaterThanOrEqual(coverage.mainBottom - 1);
    expect(coverage.footerTop).toBeLessThanOrEqual(coverage.sceneBottom + 1);
    expect(coverage.sampledPrimaryScene).toBe(true);
  });

  test('builds 404 search results for public pages only', async ({ page }) => {
    await page.goto('/totally-missing-seo-audit-test/');
    await page.waitForLoadState('networkidle');

    const results = await page.evaluate(async () => {
      type PagefindResult = { data: () => Promise<{ url: string }> };
      type Pagefind = { search: (query: string) => Promise<{ results: PagefindResult[] }> };

      const pagefind = (await Function('return import("/pagefind/pagefind.js")')()) as Pagefind;
      const urlsFor = async (query: string) => {
        const search = await pagefind.search(query);
        const items = await Promise.all(search.results.slice(0, 10).map((result) => result.data()));
        return items.map((item) => item.url);
      };

      return {
        colophon: await urlsFor('How this website is produced and maintained'),
        qr: await urlsFor('QR Presenter'),
      };
    });

    expect(results.colophon).toContain('/colophon/');
    expect(results.qr).not.toContain('/qr/');
  });
});
