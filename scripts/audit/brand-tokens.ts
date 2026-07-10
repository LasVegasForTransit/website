#!/usr/bin/env tsx
/**
 * Guard the brand palette and global.css's structural invariants.
 *
 * Check 1 — hex drift: every color literal in the files that hand-copy brand
 * values (the /brand token tables, QR SVG generator, OG-image script, test
 * helpers) must match a primitive declared in global.css's `:root` blocks or
 * appear in the explicit allowlist. Without this, tuning a primitive in CSS
 * silently strands stale hexes in the public brand book and the contrast
 * tests.
 *
 * Check 2 — unlayered zone: global.css deliberately keeps a small set of
 * rules outside @layer so they outrank Tailwind's layered utilities; comments
 * document each one. That policy is only prose, and it has failed before (a
 * whole rule block ended up duplicated inside and outside @layer base). Every
 * top-level block must match the allowlist below; anything else fails.
 *
 * Usage: tsx scripts/audit/brand-tokens.ts [--json]
 *   exit 1 if either check finds a violation — this is a gate.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const asJson = process.argv.includes('--json');
const root = resolve(import.meta.dirname, '../..');
const globalCss = readFileSync(resolve(root, 'src/styles/global.css'), 'utf8');

// ── Check 1: hex drift ───────────────────────────────────────────────────

/** Files that are allowed to carry brand hexes, and are checked for drift. */
const HEX_CARRIERS = [
  'src/pages/brand.astro',
  'src/pages/qr.astro',
  'src/lib/qr-svg.ts',
  'scripts/generate-og-image.ts',
  'tests/a11y-helpers.ts',
  'tests/body-links.spec.ts',
  'tests/color-contracts.spec.ts',
];

/** Deliberate off-palette literals, each with a reason. Entries here must
 *  be traceable to a real brand asset or an explicit design decision —
 *  "looks intentional" does not qualify. */
const HEX_ALLOWLIST = new Set<string>([
  // The light-mode logo mark's letter fills, as shipped in
  // public/brand/lvbt-logo.svg — logo asset colors, not UI palette tokens.
  '#6c5d2e',
  '#77574e',
  '#8f4b39',
  // The OG-image logo (on-dark variant): cream rings/heading, lightened
  // letter fills, and muted body text baked into the raster share card by
  // scripts/generate-og-image.ts — asset colors, not UI palette tokens.
  '#f1dfda',
  '#c49a8c',
  '#a88a80',
  '#9c9060',
  '#7a6a66',
]);

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Palette = every hex declared in a top-level :root block (light + the
// dark-scheme re-point). @theme roles reference these via var(), so the
// primitives are the single source of truth for raw color values.
const paletteHexes = new Set<string>();
for (const rootBlock of stripComments(globalCss).matchAll(/:root\s*\{([^}]*)\}/g)) {
  for (const hex of (rootBlock[1] ?? '').matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    paletteHexes.add(hex[0].toLowerCase());
  }
}

type Drift = { file: string; line: number; hex: string };
const drifts: Drift[] = [];
for (const rel of HEX_CARRIERS) {
  const lines = readFileSync(resolve(root, rel), 'utf8').split('\n');
  lines.forEach((text, i) => {
    for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
      const hex = m[0].toLowerCase();
      if (!paletteHexes.has(hex) && !HEX_ALLOWLIST.has(hex)) {
        drifts.push({ file: rel, line: i + 1, hex });
      }
    }
  });
}

// ── Check 2: unlayered zone ──────────────────────────────────────────────

/**
 * Every selector/at-rule allowed to sit at global.css's top level, i.e.
 * OUTSIDE @layer. Each entry corresponds to a documented cascade-override
 * need in the file. Extending this list means you have read (and updated)
 * the comment on the rule you are adding.
 */
const UNLAYERED_ALLOWLIST: RegExp[] = [
  /^@import\b/,
  /^@plugin\b/,
  /^@layer\b/,
  /^@theme\b/,
  /^@font-face$/,
  /^@property\b/,
  /^@keyframes\b/,
  /^@view-transition$/,
  /^@starting-style$/,
  /^@media \(prefers-color-scheme: dark\)$/,
  /^@media \(prefers-reduced-motion: reduce\)$/,
  /^@supports \(animation-timeline: scroll\(\)\)$/,
  /^:root$/,
  // Typography-plugin re-point + footnote styling (outranks the plugin's own
  // unlayered .prose rules by source order).
  /^\.prose\b/,
  // First-paint chrome: scroll progress bar and the <main> entrance.
  /^\.site-scroll-progress$/,
  /^main$/,
  // View-transition pseudo-elements and the /qr shared-element tagging.
  /^::view-transition/,
  /^html:active-view-transition-type\(/,
  // Dark-canvas header inversion (outranks Tailwind utility layer).
  /^body\[data-canvas='dark'\]/,
];

/** Top-level block preludes (selector or at-rule up to `{`) in source order. */
function topLevelPreludes(css: string): string[] {
  const src = stripComments(css);
  const preludes: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of src) {
    if (ch === '{') {
      if (depth === 0) preludes.push(buf.replace(/\s+/g, ' ').trim());
      depth += 1;
      buf = '';
    } else if (ch === '}') {
      depth -= 1;
      buf = '';
    } else if (ch === ';' && depth === 0) {
      buf = ''; // top-level statement (@import, @plugin) — not a block
    } else if (depth === 0) {
      buf += ch;
    }
  }
  return preludes;
}

const unlayeredViolations = topLevelPreludes(globalCss).filter(
  (prelude) => !UNLAYERED_ALLOWLIST.some((re) => re.test(prelude)),
);

// ── Report ───────────────────────────────────────────────────────────────

const failed = drifts.length > 0 || unlayeredViolations.length > 0;

if (asJson) {
  process.stdout.write(
    JSON.stringify({ palette: [...paletteHexes].sort(), drifts, unlayeredViolations }, null, 2) +
      '\n',
  );
} else {
  if (drifts.length > 0) {
    process.stdout.write(`brand-tokens: ${drifts.length} off-palette hex literal(s)\n`);
    for (const { file, line, hex } of drifts) {
      process.stdout.write(`  ${file}:${line}  ${hex}\n`);
    }
  }
  if (unlayeredViolations.length > 0) {
    process.stdout.write(
      `brand-tokens: ${unlayeredViolations.length} unlisted top-level (unlayered) block(s) in global.css\n`,
    );
    for (const sel of unlayeredViolations) {
      process.stdout.write(`  ${sel}\n`);
    }
  }
  if (!failed) {
    process.stdout.write(
      `brand-tokens: ${paletteHexes.size} palette values; carriers in sync; unlayered zone matches its allowlist\n`,
    );
  }
}

process.exit(failed ? 1 : 0);
