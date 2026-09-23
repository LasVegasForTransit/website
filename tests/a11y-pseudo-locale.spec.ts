import { expect, test } from '@playwright/test';

// The long-text check: with the site built in the en-XA pseudo-language
// (LVBT_PSEUDO_LOCALE=1), every member-facing message is about 40 percent
// longer and accented, the way Spanish or another language would be. The join
// and sign-in pages must still fit a 320-pixel phone without sideways
// scrolling or clipped text. Skipped in an ordinary English build.

const PAGES = [
  '/join/member/',
  '/join/member/welcome/',
  '/sign-in/',
  '/sign-in/link/',
  '/sign-out/',
  '/account/deleted/',
];

test.describe('long text (en-XA)', () => {
  test.skip(
    // eslint-disable-next-line turbo/no-undeclared-env-vars -- Audit-only switch; this single-package repo has no Turbo task config.
    process.env.LVBT_PSEUDO_LOCALE !== '1',
    'needs a build with LVBT_PSEUDO_LOCALE=1',
  );
  test.use({ viewport: { width: 320, height: 720 } });

  for (const path of PAGES) {
    test(`${path} fits a phone with longer text`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA');
      await expect(page.locator('h1').first()).toContainText('[');

      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(sideways, 'the page scrolls sideways').toBe(false);

      // Text that is cut off: a visible text element wider than its own box.
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll('main h1, main h2, main p, main label, main button, main a')]
          .filter((element) => {
            if (getComputedStyle(element).display === 'inline') return false;
            const box = element.getBoundingClientRect();
            return box.width > 0 && element.scrollWidth > element.clientWidth + 1;
          })
          .map((element) => element.textContent.trim().slice(0, 40)),
      );
      expect(clipped, 'text is cut off').toEqual([]);
    });
  }
});
