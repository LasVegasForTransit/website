import { expect, test } from '@playwright/test';

test.describe('header current navigation', () => {
  test('marks nav links current only on exact route matches', async ({ page }) => {
    const desktopPrograms = page.locator('nav[aria-label="Primary"] a[href="/programs"]');

    await page.goto('/programs');
    await page.waitForLoadState('networkidle');
    await expect(desktopPrograms).toHaveAttribute('aria-current', 'page');
    const activeDesktopColor = await desktopPrograms.evaluate(
      (link) => getComputedStyle(link).color,
    );

    const inactiveDesktopColor = await page
      .locator('nav[aria-label="Primary"] a[href="/about"]')
      .evaluate((link) => getComputedStyle(link).color);
    expect(activeDesktopColor).not.toBe(inactiveDesktopColor);

    await page.goto('/projects');
    await page.waitForLoadState('networkidle');
    await expect(desktopPrograms).not.toHaveAttribute('aria-current', 'page');

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
