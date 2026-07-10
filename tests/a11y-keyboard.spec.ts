import { expect, test } from '@playwright/test';
import { preparePageForA11y } from './a11y-helpers';

test.describe('keyboard accessibility', () => {
  test('mobile navigation traps focus while open and restores it on Escape', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/about');
    await preparePageForA11y(page);

    const toggle = page.locator('button[data-nav-toggle]');
    const overlay = page.locator('[data-nav-overlay]');
    const firstOverlayLink = overlay.locator('a[href]').first();
    const lastOverlayLink = overlay.locator('a[href]').last();

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(overlay).toHaveAttribute('inert', '');

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAttribute('aria-label', 'Close menu');
    await expect(overlay).not.toHaveAttribute('inert', '');
    await expect(firstOverlayLink).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(lastOverlayLink).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(firstOverlayLink).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAttribute('aria-label', 'Open menu');
    await expect(overlay).toHaveAttribute('inert', '');
    await expect(toggle).toBeFocused();
  });

  test('brand contents summary is keyboard operable below the rail breakpoint', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/brand');
    await preparePageForA11y(page);

    const contents = page.locator('[data-brand-contents]');
    const summary = contents.locator('> summary');

    await expect(contents).not.toHaveAttribute('open', '');
    await summary.focus();
    await expect(summary).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(contents).toHaveAttribute('open', '');

    await page.keyboard.press('Space');
    await expect(contents).not.toHaveAttribute('open', '');
  });

  test('brand logo tabs expose selected tabs and controlled panels', async ({ page }) => {
    await page.goto('/brand');
    await preparePageForA11y(page);

    const familyTabs = page.locator('[data-brand-logo-tabs] [role="tab"]');
    const themeTabs = page.locator('[data-brand-logo-theme-tabs] [role="tab"]');
    const markTab = page.locator('[data-logo-family-tab="mark"]');
    const wordmarkTab = page.locator('[data-logo-family-tab="wordmark"]');
    const lightTab = page.locator('[data-logo-tab="light"]');
    const darkTab = page.locator('[data-logo-tab="dark"]');

    await expect(familyTabs).toHaveCount(2);
    await expect(themeTabs).toHaveCount(2);
    await expect(markTab).toHaveAttribute('aria-selected', 'true');
    await expect(markTab).toHaveAttribute('tabindex', '0');
    await expect(wordmarkTab).toHaveAttribute('aria-selected', 'false');
    await expect(wordmarkTab).toHaveAttribute('tabindex', '-1');
    await expect(lightTab).toHaveAttribute('aria-selected', 'true');
    await expect(darkTab).toHaveAttribute('aria-selected', 'false');

    await expect(page.locator('#logos-mark-light-panel')).toHaveAttribute('role', 'tabpanel');
    await expect(page.locator('#logos-mark-light-panel')).toHaveAttribute(
      'aria-labelledby',
      'logos-family-mark-tab logos-theme-light-tab',
    );

    await wordmarkTab.click();
    await darkTab.click();

    await expect(wordmarkTab).toHaveAttribute('aria-selected', 'true');
    await expect(wordmarkTab).toHaveAttribute('tabindex', '0');
    await expect(markTab).toHaveAttribute('tabindex', '-1');
    await expect(darkTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#logos-wordmark-dark-panel')).toBeVisible();
    await expect(page.locator('#logos-mark-light-panel')).toBeHidden();
  });
});
