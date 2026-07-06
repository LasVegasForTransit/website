import { expect, test } from '@playwright/test';

test.describe('typography contracts', () => {
  test('keeps top-level section headings on the larger MD3 headline style', async ({ page }) => {
    for (const path of ['/go', '/join', '/contact', '/events']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const classes = await page.locator('main section h2').evaluateAll((headings) =>
        headings.map((heading) => ({
          text: (heading as HTMLElement).innerText,
          className: (heading as HTMLElement).className,
        })),
      );

      expect(classes.length, path).toBeGreaterThan(0);
      expect(
        classes.every(({ className }) => className.includes('text-headline-lg')),
        JSON.stringify({ path, classes }),
      ).toBe(true);
      expect(
        classes.some(({ className }) => /text-(headline-md|headline-sm)/.test(className)),
        JSON.stringify({ path, classes }),
      ).toBe(false);
    }
  });

  test('does not render overline all-caps labels in site chrome and body content', async ({
    page,
  }) => {
    for (const path of ['/', '/go', '/join', '/colophon', '/contact', '/events', '/qr']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const transformed = await page
        .locator('body p, body span, body a, body button, body dt, body cite')
        .evaluateAll((elements) =>
          elements
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            })
            .map((element) => {
              const style = getComputedStyle(element);
              return {
                text: (element.textContent ?? '').trim(),
                textTransform: style.textTransform,
              };
            })
            .filter(({ text, textTransform }) => text && textTransform === 'uppercase'),
        );

      expect(transformed, path).toEqual([]);
    }
  });
});
