import { expect, test } from '../../scripts/deploy/access-browser';

test('opens programs at the top and snaps navigation below the header', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/programs');
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollSnapType)).toBe(
    'y',
  );

  const destination = page.locator('.program-index a[href="#week-without-driving"]');
  await destination.click();
  await expect(destination).toHaveAttribute('aria-current', 'location');
  await expect
    .poll(async () => {
      const section = await page.locator('#week-without-driving').boundingBox();
      const header = await page.locator('[data-site-header]').boundingBox();
      return Math.abs((section?.y ?? Infinity) - (header?.height ?? 0));
    })
    .toBeLessThan(1);
});
