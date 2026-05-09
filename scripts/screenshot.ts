/**
 * Ad-hoc screenshot runner for the local dev server.
 *
 * Usage:
 *   pnpm tsx scripts/screenshot.ts <path> [--out <file>] [--w 1440] [--h 900]
 *                                          [--scrolled <px>] [--full]
 *                                          [--host https://lvbt.localhost:1355]
 *
 * Examples:
 *   pnpm tsx scripts/screenshot.ts /vision
 *   pnpm tsx scripts/screenshot.ts /vision --scrolled 1200 --out /tmp/v-scrolled.png
 *   pnpm tsx scripts/screenshot.ts / --w 390 --h 844 --out /tmp/home-mobile.png
 *
 * Output defaults to /tmp/lvbt-<path>.png. Reads dev server from --host or
 * env LVBT_DEV_URL; falls back to https://lvbt.localhost:1355 (the portless
 * default for this project — see `pnpm dev`).
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

interface Args {
  path: string;
  out: string;
  w: number;
  h: number;
  scrolled: number | null;
  full: boolean;
  host: string;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next as string;
        i++;
      }
    } else {
      positional.push(a);
    }
  }

  const path = positional[0] ?? '/';
  const slug = path === '/' ? 'root' : path.replace(/^\/|\/$/g, '').replace(/\//g, '-');
  return {
    path,
    out: (flags.out as string) ?? `/tmp/lvbt-${slug}.png`,
    w: Number(flags.w ?? 1440),
    h: Number(flags.h ?? 900),
    scrolled: flags.scrolled != null && flags.scrolled !== true ? Number(flags.scrolled) : null,
    full: flags.full === true,
    host:
      (flags.host as string) ?? process.env.LVBT_DEV_URL ?? 'https://lvbt.localhost:1355',
  };
}

const args = parseArgs(process.argv.slice(2));
const url = new URL(args.path, args.host).toString();

mkdirSync(dirname(args.out), { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: args.w, height: args.h },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
// Settle web fonts so text doesn't flash mid-capture (matches tests/screenshots.spec.ts)
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

if (args.scrolled != null) {
  await page.evaluate((y) => window.scrollTo(0, y), args.scrolled);
  await page.waitForTimeout(400);
}

await page.screenshot({ path: args.out, fullPage: args.full });
await browser.close();

console.log(`✓ ${url} → ${args.out} (${args.w}×${args.h}${args.full ? ', full' : ''}${args.scrolled != null ? `, scrolled ${args.scrolled}px` : ''})`);
