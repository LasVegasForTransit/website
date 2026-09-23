// Checks every page of the app pattern gallery: WCAG 2.2 A and AA rules, reflow
// at 320 CSS pixels, keyboard reachability with a visible focus change, and
// names and error descriptions on every field, and the same for every
// prototype. The page lists come from the gallery's and the prototypes' own
// indexes, so a new pattern or prototype is checked as soon as it is listed.
// The gallery exists only in builds with PUBLIC_LVBT_PREVIEW_PAGES=1; other
// builds skip these checks.
import AxeBuilder from '@axe-core/playwright';
import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { preparePageForA11y } from './a11y-helpers';

const galleryBuilt = existsSync(new URL('../dist/patterns/index.html', import.meta.url));

async function indexedPages(page: Page, index: string, list: string): Promise<string[]> {
  await page.goto(index);
  const hrefs = await page
    .locator(`${list} a`)
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  return [index, ...hrefs.filter(Boolean)];
}

async function galleryPages(page: Page): Promise<string[]> {
  return [
    ...(await indexedPages(page, '/patterns/', '[data-pattern-index]')),
    ...(await indexedPages(page, '/prototypes/', '[data-prototype-index]')),
  ];
}

async function focusChanges(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const selector =
      'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex="0"]';
    const elements = [...document.querySelectorAll<HTMLElement>(selector)].filter(
      (element) =>
        !element.closest('[hidden]') &&
        !(element as HTMLInputElement).disabled &&
        element.getClientRects().length > 0,
    );
    const look = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      return `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor} ${style.boxShadow}`;
    };
    for (const element of elements) {
      element.blur();
      const before = look(element);
      element.focus();
      if (document.activeElement !== element) {
        problems.push(`not focusable: ${element.outerHTML.slice(0, 80)}`);
        continue;
      }
      if (look(element) === before)
        problems.push(`no visible focus: ${element.outerHTML.slice(0, 80)}`);
    }
    return problems;
  });
}

async function fieldProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const named = (field: HTMLInputElement) =>
      (field.labels?.length ?? 0) > 0 ||
      field.hasAttribute('aria-label') ||
      field.hasAttribute('aria-labelledby');
    const fields = [...document.querySelectorAll<HTMLInputElement>('input, select, textarea')];
    const unnamed = fields
      .filter((field) => field.type !== 'hidden' && !field.closest('[aria-hidden="true"]'))
      .filter((field) => !named(field))
      .map((field) => `field without a name: ${field.name || field.id}`);
    const errors = [...document.querySelectorAll<HTMLElement>('[data-error-for]:not([hidden])')];
    const untied = errors
      .filter((error) => {
        const field = document.getElementById(error.dataset.errorFor ?? '');
        return !(field?.getAttribute('aria-describedby') ?? '').split(/\s+/).includes(error.id);
      })
      .map((error) => `error not tied to its field: ${error.dataset.errorFor ?? ''}`);
    return [...unnamed, ...untied];
  });
}

test.describe('app pattern gallery', () => {
  test.skip(!galleryBuilt, 'The pattern gallery is not in this build.');

  test('every gallery page passes the pattern checks', async ({ page }) => {
    test.setTimeout(120_000);
    for (const path of await galleryPages(page)) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(path);
      await preparePageForA11y(page);

      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        axe.violations.map((violation) => `${violation.id}: ${violation.help}`),
        `${path}: WCAG 2.2 A and AA rules`,
      ).toEqual([]);

      expect(await fieldProblems(page), `${path}: every field has a name and tied errors`).toEqual(
        [],
      );
      expect(await focusChanges(page), `${path}: keyboard focus is reachable and visible`).toEqual(
        [],
      );

      await page.setViewportSize({ width: 320, height: 640 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(
        overflow,
        `${path}: content fits 320 pixels without sideways scrolling`,
      ).toBeLessThanOrEqual(0);
    }
  });
});
