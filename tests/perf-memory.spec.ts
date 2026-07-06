import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { builtSitemapPaths } from './sitemap-paths';

// Same sitemap-driven URL list as a11y.spec.ts / screenshots.spec.ts so
// dynamic content-collection routes are checked automatically. Memory is
// measured via Chromium's `performance.memory.usedJSHeapSize` (non-standard,
// Chrome-only) — the perf-memory Playwright project pins itself to Desktop
// Chrome so this works.
//
// What this guards: a regression that introduces a JS retainer — typically
// a long-lived event listener, a DOM-referencing closure, or an
// IntersectionObserver that never `unobserve`s. The known live observer
// in BaseLayout.astro unobserves on first intersection, so a clean page
// should land well under the budget; a meaningful breach means a new
// retainer slipped in.
const BUDGET_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../perf-budgets.json');

interface PerfBudgets {
  runtime: { usedJsHeapMb: number };
}
const budget = (JSON.parse(readFileSync(BUDGET_PATH, 'utf8')) as PerfBudgets).runtime.usedJsHeapMb;

const paths = builtSitemapPaths(import.meta.url);

// Chromium-only API. Skip cleanly on any other browser so this spec can
// still be invoked from a multi-browser run without false failures.
test.skip(({ browserName }) => browserName !== 'chromium', 'performance.memory is Chrome-only');

for (const path of paths) {
  test(`perf-memory: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    // Scroll to the bottom so every reveal observer fires and unobserves —
    // a leaked observer surfaces as a steady climb in heap rather than
    // a one-shot allocation. Three slow scrolls give layout, paint, and
    // any deferred work time to complete.
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(500);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    // Ask Chrome to do a major GC before sampling so we measure retained
    // memory, not transient allocations waiting to be collected. The CDP
    // `HeapProfiler.collectGarbage` is the same hook DevTools uses.
    const client = await page.context().newCDPSession(page);
    await client.send('HeapProfiler.enable');
    await client.send('HeapProfiler.collectGarbage');
    await client.detach();

    const usedMb = await page.evaluate(() => {
      // performance.memory is non-standard but stable in Chromium.
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      if (!mem) throw new Error('performance.memory unavailable in this browser');
      return mem.usedJSHeapSize / 1024 / 1024;
    });

    if (usedMb > budget) {
      throw new Error(
        `perf-memory: ${path} used ${usedMb.toFixed(1)} MB of JS heap; budget is ${budget} MB.\n` +
          `Likely cause: a new event listener, observer, or closure is retaining DOM.\n` +
          `Reproduce: pnpm build && pnpm preview, open the page, take a heap snapshot in DevTools.`,
      );
    }
    expect(usedMb).toBeLessThanOrEqual(budget);
  });
}
