#!/usr/bin/env tsx
/**
 * Bundle-size audit. Walks dist/_astro and dist/scripts for .css/.js,
 * computes gzipped bytes per file via zlib (level 9, same algorithm
 * Cloudflare serves), and fails if any total or individual file
 * exceeds the limits in perf-budgets.json.
 *
 * Usage: tsx scripts/audit/bundle-size.ts [--dist=path] [--json]
 *   exit 0 = under budget, exit 1 = budget breach (or no files found)
 */

import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseAuditArgs } from './_shared.js';

interface BundleBudget {
  cssGzipKb: number;
  jsGzipKb: number;
  totalGzipKb: number;
  individualFileGzipKb: number;
}

interface FileMeasure {
  path: string;
  ext: 'css' | 'js';
  rawBytes: number;
  gzipBytes: number;
}

const { distDir, asJson } = parseAuditArgs();
const repoRoot = resolve(process.cwd());

function loadBudget(): BundleBudget {
  const raw = JSON.parse(readFileSync(resolve(repoRoot, 'perf-budgets.json'), 'utf8')) as {
    bundle: BundleBudget;
  };
  return raw.bundle;
}

// dist/_astro/**/*.{css,js} plus dist/scripts/*.js (the static-served
// /scripts directory holds the inline-CSP-safe public scripts).
function collectBundleFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && (full.endsWith('.css') || full.endsWith('.js'))) out.push(full);
    }
  }
  walk(join(root, '_astro'));
  walk(join(root, 'scripts'));
  return out.sort();
}

function measure(file: string): FileMeasure {
  const buf = readFileSync(file);
  const gz = gzipSync(buf, { level: 9 });
  const ext = file.endsWith('.css') ? 'css' : 'js';
  return { path: file.slice(distDir.length + 1), ext, rawBytes: buf.length, gzipBytes: gz.length };
}

const budget = loadBudget();
const files = collectBundleFiles(distDir).map(measure);

const cssGz = files.filter((f) => f.ext === 'css').reduce((s, f) => s + f.gzipBytes, 0);
const jsGz = files.filter((f) => f.ext === 'js').reduce((s, f) => s + f.gzipBytes, 0);
const totalGz = cssGz + jsGz;

const breaches: string[] = [];
const KB = 1024;
if (cssGz > budget.cssGzipKb * KB) {
  breaches.push(`CSS total ${(cssGz / KB).toFixed(2)} KB gz > ${budget.cssGzipKb} KB budget`);
}
if (jsGz > budget.jsGzipKb * KB) {
  breaches.push(`JS total ${(jsGz / KB).toFixed(2)} KB gz > ${budget.jsGzipKb} KB budget`);
}
if (totalGz > budget.totalGzipKb * KB) {
  breaches.push(
    `Bundle total ${(totalGz / KB).toFixed(2)} KB gz > ${budget.totalGzipKb} KB budget`,
  );
}
for (const f of files) {
  if (f.gzipBytes > budget.individualFileGzipKb * KB) {
    breaches.push(
      `${f.path}: ${(f.gzipBytes / KB).toFixed(2)} KB gz > ${budget.individualFileGzipKb} KB per-file budget`,
    );
  }
}

if (files.length === 0) {
  process.stderr.write(`bundle-size: no .css or .js files found in ${distDir}\n`);
  process.exit(1);
}

if (asJson) {
  process.stdout.write(
    JSON.stringify(
      {
        ok: breaches.length === 0,
        budget,
        totals: { cssGz, jsGz, totalGz },
        files,
        breaches,
      },
      null,
      2,
    ) + '\n',
  );
} else {
  const widthPath = Math.max(...files.map((f) => f.path.length));
  for (const f of files) {
    process.stdout.write(
      `  ${f.path.padEnd(widthPath)}  ${(f.rawBytes / KB).toFixed(2).padStart(7)} KB raw  ${(f.gzipBytes / KB).toFixed(2).padStart(6)} KB gz\n`,
    );
  }
  process.stdout.write(
    `\n  totals: CSS ${(cssGz / KB).toFixed(2)} KB gz  ·  JS ${(jsGz / KB).toFixed(2)} KB gz  ·  combined ${(totalGz / KB).toFixed(2)} KB gz\n`,
  );
  process.stdout.write(
    `  budget: CSS ${budget.cssGzipKb} KB  ·  JS ${budget.jsGzipKb} KB  ·  combined ${budget.totalGzipKb} KB  ·  per-file ${budget.individualFileGzipKb} KB\n`,
  );
  if (breaches.length > 0) {
    process.stderr.write('\n  breaches:\n');
    for (const b of breaches) process.stderr.write(`    - ${b}\n`);
  }
}

process.exit(breaches.length === 0 ? 0 : 1);
