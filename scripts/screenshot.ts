/**
 * Ad-hoc screenshot runner for the local dev server.
 *
 * Usage:
 *   pnpm screenshot <path> [--out <file>] [--w 1440] [--h 900]
 *                          [--scrolled <px>] [--full] [--scale 2]
 *                          [--host https://lvbt.localhost:1355]
 *
 * Examples:
 *   pnpm screenshot /vision
 *   pnpm screenshot /vision --scrolled 1200 --out /tmp/v-scrolled.png
 *   pnpm screenshot / --w 390 --h 844 --out /tmp/home-mobile.png
 *
 * Output defaults to /tmp/lvbt-<path>.png. Reads dev server from --host or
 * env LVBT_DEV_URL; falls back to https://lvbt.localhost:1355 (the portless
 * default for this project — see `pnpm dev`).
 *
 * The page-settle sequence mirrors tests/screenshots.spec.ts so ad-hoc
 * captures compare cleanly against CI baselines: networkidle → fonts.ready →
 * force `.reveal*` IO classes to their final state.
 */
import { chromium, type Page } from '@playwright/test';
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
  scale: number;
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

  const scrolledRaw = flags.scrolled;
  if (scrolledRaw === true) {
    console.error('--scrolled requires a pixel value, e.g. --scrolled 1200');
    process.exit(2);
  }

  const path = positional[0] ?? '/';
  const slug = path === '/' ? 'root' : path.replace(/^\/|\/$/g, '').replace(/\//g, '-');
  return {
    path,
    out: (flags.out as string) ?? `/tmp/lvbt-${slug}.png`,
    w: Number(flags.w ?? 1440),
    h: Number(flags.h ?? 900),
    scrolled: scrolledRaw != null ? Number(scrolledRaw) : null,
    full: flags.full === true,
    host: (flags.host as string) ?? process.env.LVBT_DEV_URL ?? 'https://lvbt.localhost:1355',
    scale: Number(flags.scale ?? 2),
  };
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // Match tests/screenshots.spec.ts: deterministically force the IO-driven
  // reveal classes to their final state so captures don't race the observer.
  await page.evaluate(() => {
    document
      .querySelectorAll('.reveal, .reveal-stat, .reveal-quote')
      .forEach((el) => el.classList.add('is-visible'));
  });
}

const args = parseArgs(process.argv.slice(2));
const url = new URL(args.path, args.host).toString();

mkdirSync(dirname(args.out), { recursive: true });

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: args.w, height: args.h },
    deviceScaleFactor: args.scale,
  });
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  await settle(page);

  if (args.scrolled != null) {
    await page.evaluate((y) => window.scrollTo(0, y), args.scrolled);
    await page.waitForTimeout(400);
  }

  await page.screenshot({ path: args.out, fullPage: args.full });
} finally {
  await browser.close();
}

const detail = [
  `${args.w}×${args.h}`,
  args.full && 'full',
  args.scrolled != null && `scrolled ${args.scrolled}px`,
]
  .filter(Boolean)
  .join(', ');
console.log(`✓ ${url} → ${args.out} (${detail})`);
