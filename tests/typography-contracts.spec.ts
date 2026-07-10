import { expect, test, type Page } from '@playwright/test';
import { builtHtmlPagePaths } from './sitemap-paths';

const paths = builtHtmlPagePaths(import.meta.url);

async function uppercaseStyleViolations(page: Page): Promise<
  Array<{
    tagName: string;
    text: string;
    textTransform: string;
    className: string;
  }>
> {
  return page.locator('body *').evaluateAll((elements) =>
    elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        );
      })
      .map((element) => {
        const style = getComputedStyle(element);
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();

        return {
          tagName: element.tagName.toLowerCase(),
          text,
          textTransform: style.textTransform,
          className: (element as HTMLElement).className.toString(),
        };
      })
      .filter(({ text, textTransform }) => text && textTransform === 'uppercase')
      .map(({ tagName, text, textTransform, className }) => ({
        tagName,
        text,
        textTransform,
        className,
      })),
  );
}

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

  for (const path of paths) {
    test(`does not style visible text as uppercase: ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      expect(await uppercaseStyleViolations(page), `${path} screen media`).toEqual([]);

      await page.emulateMedia({ media: 'print' });
      expect(await uppercaseStyleViolations(page), `${path} print media`).toEqual([]);
      await page.emulateMedia({ media: 'screen' });
    });
  }
});
