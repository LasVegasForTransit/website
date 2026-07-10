import { expect, test } from '@playwright/test';
import { builtHtmlPagePaths } from './sitemap-paths';
import {
  axeBlockingViolations,
  preparePageForA11y,
  semanticPageAudit,
  summarizeViolations,
  unnamedVisibleControls,
} from './a11y-helpers';

// Build-output driven so noindex utility pages like /qr/ are audited too.
// axe runs in one viewport only — accessibility findings don't differ
// meaningfully across breakpoints for this site, and running 6× would 6× the
// CI cost for ~no extra signal.
const paths = builtHtmlPagePaths(import.meta.url);

for (const path of paths) {
  test(`page accessibility smoke: ${path}`, async ({ page }) => {
    await page.goto(path);
    await preparePageForA11y(page);

    const blocking = await axeBlockingViolations(page);
    if (blocking.length > 0) {
      throw new Error(
        `axe found ${blocking.length} actionable violation(s):\n${summarizeViolations(blocking)}`,
      );
    }
    expect(blocking).toHaveLength(0);

    const unnamedControls = await unnamedVisibleControls(page);
    expect(unnamedControls, `${path} should not expose unnamed visible controls`).toEqual([]);

    const semantics = await semanticPageAudit(page);

    expect(semantics.mainCount, `${path} should expose exactly one main landmark`).toBe(1);
    expect(semantics.h1Text, `${path} should expose exactly one h1`).toHaveLength(1);
    expect(semantics.skipLinkHasTarget, `${path} skip link should target #main`).toBe(true);
    expect(semantics.headingJumps, `${path} should not skip heading levels`).toEqual([]);
  });
}
