import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Same sitemap-driven URL list as screenshots.spec.ts so dynamic content-
// collection routes are covered automatically. axe runs in one viewport
// only — accessibility findings don't differ meaningfully across breakpoints
// for this site, and running 6× would 6× the CI cost for ~no extra signal.
const SITEMAP_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/sitemap-0.xml');
const PROD_ORIGIN = 'https://lasvegasfortransit.org';

const sitemap = readFileSync(SITEMAP_PATH, 'utf8');
const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => (m[1] ?? '').replace(PROD_ORIGIN, ''))
  .map((p) => p || '/');

if (paths.length === 0) {
  throw new Error(`No URLs found in ${SITEMAP_PATH}. Did the build run?`);
}

for (const path of paths) {
  test(`a11y: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    // Force scroll-triggered reveals to their final state so axe sees real
    // contrast/structure, not the hidden initial state.
    await page.evaluate(() => {
      document
        .querySelectorAll('.reveal, .reveal-stat, .reveal-quote')
        .forEach((el) => el.classList.add('is-visible'));
    });

    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    // Gate on serious + critical only. Minor/moderate findings still appear
    // in the report but don't fail CI — they're judgment calls.
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    if (blocking.length > 0) {
      const summary = blocking
        .map(
          (v) =>
            `  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`,
        )
        .join('\n');
      throw new Error(`axe found ${blocking.length} serious/critical violation(s):\n${summary}`);
    }
    expect(blocking).toHaveLength(0);
  });
}
