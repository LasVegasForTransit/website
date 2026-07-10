import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

// Routes are sourced from the built sitemap so dynamic content-collection
// routes (projects, events) stay in sync without a hand-maintained list.
// Requires `pnpm build` to have produced dist/sitemap-0.xml — Playwright's
// webServer config runs the build before this spec executes.
const SITEMAP_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/sitemap-0.xml');
const PROD_ORIGIN = 'https://lasvegasfortransit.org';

const sitemap = readFileSync(SITEMAP_PATH, 'utf8');
const allPaths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => m[1].replace(PROD_ORIGIN, ''))
  .map((p) => p || '/');

if (allPaths.length === 0) {
  throw new Error(`No URLs found in ${SITEMAP_PATH}. Did the build run?`);
}

// Content-collection detail pages (projects/<slug>, events/<slug>, join/<slug>,
// ...) share one template per family — screenshotting every instance just
// multiplies the baseline count without adding visual coverage. Keep one
// exemplar per family (the first in sitemap order) and drop the rest.
const detailChildrenBySegment = new Map<string, string[]>();
for (const path of allPaths) {
  const [segment, ...rest] = path.split('/').filter(Boolean);
  if (!segment || rest.length === 0) continue; // top-level page, not a detail page
  detailChildrenBySegment.set(segment, [...(detailChildrenBySegment.get(segment) ?? []), path]);
}
const skippedDuplicates = new Set(
  [...detailChildrenBySegment.values()]
    .filter((children) => children.length > 1)
    .flatMap((children) => children.slice(1)),
);
const paths = allPaths.filter((path) => !skippedDuplicates.has(path));

if (skippedDuplicates.size > 0) {
  console.log(
    `[screenshots] skipping ${skippedDuplicates.size} duplicate detail-page route(s), keeping one exemplar per family`,
  );
}

// Each route gets two snapshots: a viewport-only capture (what the user
// sees on initial load, no scrolling) and a full-page capture (everything
// down the scroll). Together they catch above-the-fold regressions and
// long-page layout regressions independently.
for (const path of paths) {
  const base = path === '/' ? 'root' : path.replace(/^\/|\/$/g, '').replace(/\//g, '-');

  test.describe(`page ${path}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      // Wait for web fonts to settle — otherwise the snapshot can race
      // the Public Sans variable font and produce flaky diffs.
      await page.evaluate(() => document.fonts.ready);
      // Force scroll-triggered reveal elements to their final state so
      // baselines are deterministic regardless of which IO callbacks
      // have fired by capture time.
      await page.evaluate(() => {
        document
          .querySelectorAll('.reveal, .reveal-stat, .reveal-quote')
          .forEach((el) => el.classList.add('is-visible'));
      });
    });

    test('viewport (initial load)', async ({ page }) => {
      await expect(page).toHaveScreenshot(`${base}-viewport.png`, { fullPage: false });
    });

    test('full page (entire scroll)', async ({ page }) => {
      await expect(page).toHaveScreenshot(`${base}-full.png`, { fullPage: true });
    });
  });
}
