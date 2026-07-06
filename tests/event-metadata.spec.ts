import { expect, test } from '@playwright/test';

test.describe('event metadata', () => {
  test('uses date-specific metadata for recurring event pages', async ({ page }) => {
    await page.goto('/events');
    await page.waitForLoadState('networkidle');

    const eventPaths = [
      ...new Set(
        await page
          .locator('main a[href^="/events/"]')
          .evaluateAll((links) =>
            links
              .map((link) => new URL((link as HTMLAnchorElement).href).pathname)
              .filter((path) => /^\/events\/[^/]+\/?$/.test(path)),
          ),
      ),
    ];

    const metaTitlesByHeading = new Map<string, string[]>();
    for (const eventPath of eventPaths) {
      await page.goto(eventPath);
      await page.waitForLoadState('networkidle');

      const heading = (await page.locator('h1').first().innerText()).trim();
      const metaTitle = await page.title();
      const titles = metaTitlesByHeading.get(heading) ?? [];
      titles.push(metaTitle);
      metaTitlesByHeading.set(heading, titles);
    }

    const repeatedEvents = [...metaTitlesByHeading.entries()].filter(
      ([, titles]) => titles.length > 1,
    );

    expect(repeatedEvents.length).toBeGreaterThan(0);
    for (const [heading, titles] of repeatedEvents) {
      expect(new Set(titles).size, heading).toBe(titles.length);
      for (const title of titles) {
        expect(title, heading).toMatch(/[A-Z][a-z]+ \d{1,2}, 20\d{2}/);
      }
    }
  });
});
