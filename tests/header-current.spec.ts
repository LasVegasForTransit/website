import { expect, test } from '@playwright/test';

test.describe('header current navigation', () => {
  test('marks nav links current only on exact route matches', async ({ page }) => {
    const desktopJoin = page.locator('nav[aria-label="Primary"] a[href="/join"]');

    await page.goto('/join');
    await page.waitForLoadState('networkidle');
    await expect(desktopJoin).toHaveAttribute('aria-current', 'page');

    await page.goto('/join/events-coordinator');
    await page.waitForLoadState('networkidle');
    await expect(desktopJoin).not.toHaveAttribute('aria-current', 'page');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/about');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-nav-toggle]').click();
    await expect(
      page.locator('nav[aria-label="Mobile navigation"] a[href="/about"]'),
    ).toHaveAttribute('aria-current', 'page');

    await page.goto('/about/strategy');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-nav-toggle]').click();
    await expect(
      page.locator('nav[aria-label="Mobile navigation"] a[href="/about"]'),
    ).not.toHaveAttribute('aria-current', 'page');
  });
});
