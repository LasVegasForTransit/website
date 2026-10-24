import { expect, test, type Locator } from '../../scripts/deploy/access-browser';
import { builtSitemapPaths } from '../support/sitemap-paths';
import { contrastRatio } from '../support/color-contrast';

const paths = builtSitemapPaths(import.meta.url);
const SCHEMES = ['light', 'dark'] as const;

async function plainSurfaceVariantDescendantPairs(surface: Locator) {
  return surface.evaluate(async (element) => {
    // Flush the interaction styles, then measure the finished state rather than a timer guess.
    await Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
    const background = getComputedStyle(element).backgroundColor;
    return [...element.querySelectorAll('.text-on-surface-variant')]
      .filter((candidate) => {
        const className = candidate.getAttribute('class') ?? '';
        return !className.includes('group-hover') && !className.includes('group-focus-visible');
      })
      .map((candidate) => ({
        background,
        color: getComputedStyle(candidate).color,
        text: candidate.textContent.trim().replace(/\s+/g, ' '),
      }));
  });
}

// Event history grows with the calendar. Keep each interaction test bounded
// while assigning every built event to exactly one group.
const eventPaths = [...new Set(paths.filter((path) => /^\/events\/[^/]+\/$/.test(path)))];
const eventsPerGroup = 6;
const eventGroups = Array.from(
  { length: Math.ceil(eventPaths.length / eventsPerGroup) },
  (_, index) => eventPaths.slice(index * eventsPerGroup, (index + 1) * eventsPerGroup),
);
for (const scheme of SCHEMES) {
  for (const [groupIndex, group] of eventGroups.entries()) {
    test(`inverted interactive surfaces keep surface variants readable [${scheme}] group ${groupIndex + 1}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/events/', { waitUntil: 'networkidle' });

      const allSurfaces = page
        .locator('.hover\\:bg-on-surface, .focus-visible\\:bg-on-surface')
        .filter({ has: page.locator('.text-on-surface-variant') });
      const renderedPaths = await allSurfaces.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('href')),
      );
      expect(renderedPaths.length).toBeGreaterThan(0);
      expect(renderedPaths.filter((path) => !eventPaths.includes(path ?? ''))).toEqual([]);
      const surfaces = allSurfaces.and(
        page.locator(group.map((path) => `[href=${JSON.stringify(path)}]`).join(', ')),
      );
      const count = await surfaces.count();
      expect(count).toBeLessThanOrEqual(group.length);

      for (let index = 0; index < count; index += 1) {
        const surface = surfaces.nth(index);
        await expect(surface).toBeVisible();

        await surface.hover();
        for (const pair of await plainSurfaceVariantDescendantPairs(surface)) {
          expect(
            contrastRatio(pair.color, pair.background),
            `hovered inverted surface "${pair.text}" [${scheme}] (${pair.color} on ${pair.background})`,
          ).toBeGreaterThanOrEqual(4.5);
        }

        await surface.focus();
        for (const pair of await plainSurfaceVariantDescendantPairs(surface)) {
          expect(
            contrastRatio(pair.color, pair.background),
            `focused inverted surface "${pair.text}" [${scheme}] (${pair.color} on ${pair.background})`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
}

for (const scheme of SCHEMES) {
  test(`inverted surface contrast waits for a slow transition [${scheme}]`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/events/', { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'a { transition-duration: 1s !important; }' });
    const surface = page
      .locator('.hover\\:bg-on-surface')
      .filter({ has: page.locator('.text-on-surface-variant') })
      .first();
    await surface.hover();
    for (const pair of await plainSurfaceVariantDescendantPairs(surface)) {
      expect(
        contrastRatio(pair.color, pair.background),
        JSON.stringify(pair),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
}
