import { expect, test } from '@playwright/test';
import { preparePageForA11y } from './a11y-helpers';

test.describe('landmark accessibility', () => {
  test('site chrome exposes one clear set of persistent landmarks', async ({ page }) => {
    await page.goto('/about');
    await preparePageForA11y(page);

    await expect(page.locator('main#main')).toHaveCount(1);
    await expect(page.locator('header[data-site-header]')).toHaveCount(1);
    await expect(page.locator('footer')).toHaveCount(1);
    await expect(page.locator('a.skip-link[href="#main"]')).toHaveText('Skip to content');
    await expect(page.locator('nav[aria-label="Primary"]')).toHaveCount(1);
    await expect(page.locator('nav[aria-label="Mobile navigation"]')).toHaveCount(1);
    await expect(page.locator('footer nav[aria-label="Site utilities"]')).toHaveCount(1);

    const landmarkLabels = await page.locator('nav[aria-label]').evaluateAll((navs) =>
      navs.map((nav) => ({
        label: nav.getAttribute('aria-label'),
        inFooter: nav.closest('footer') !== null,
      })),
    );

    expect(landmarkLabels).toEqual([
      { label: 'Primary', inFooter: false },
      { label: 'Mobile navigation', inFooter: false },
      { label: 'Site utilities', inFooter: true },
    ]);
  });

  test('chrome-free presenter pages do not inherit site navigation landmarks', async ({ page }) => {
    await page.goto('/qr');
    await preparePageForA11y(page);

    await expect(page.locator('main#main')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText('QR Presenter');
    await expect(page.locator('a.skip-link')).toHaveCount(0);
    await expect(page.locator('nav[aria-label="QR slides"]')).toHaveCount(1);

    // A <header>/<footer> only exposes a banner/contentinfo landmark when it
    // isn't nested inside article/aside/main/nav/section (HTML spec). Count
    // just the ones that would actually surface as page-chrome landmarks —
    // the flyer's own <header> masthead is nested inside its <article> and
    // is legitimately local, not page chrome.
    const chromeLandmarkCount = await page.evaluate(() => {
      const scopingAncestors = ['article', 'aside', 'main', 'nav', 'section'];
      return [...document.querySelectorAll('header, footer')].filter(
        (el) => !scopingAncestors.some((tag) => el.closest(tag)),
      ).length;
    });
    expect(chromeLandmarkCount).toBe(0);
  });

  test('permalink headings keep their visible heading names', async ({ page }) => {
    await page.goto('/brand');
    await preparePageForA11y(page);

    for (const name of ['Brand Guidelines', 'Communication layouts', 'Spacing and rhythm']) {
      await expect(page.getByRole('heading', { name })).toBeVisible();
    }

    await expect(page.getByRole('heading', { name: /Copy link to/i })).toHaveCount(0);
  });
});
