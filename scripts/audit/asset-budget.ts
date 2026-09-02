#!/usr/bin/env tsx
/**
 * Asset-budget audit. Walks public/ for PNG/JPG/JPEG files. For any
 * raster larger than `assets.maxImageKbWithoutWebp` in perf-budgets.json
 * that isn't on the exemption list, requires a sibling .webp of the
 * same stem — the WebP companion gives browsers a smaller alternative
 * to fetch via <picture>/srcset without dropping the raster fallback.
 *
 * Usage: tsx scripts/audit/asset-budget.ts [--json]
 *   exit 0 = under budget, exit 1 = a flagged raster has no companion
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

interface AssetBudget {
  maxImageKbWithoutWebp: number;
  webpExemptions: string[];
}

interface Finding {
  path: string;
  sizeKb: number;
  reason: string;
}

const asJson = process.argv.includes('--json');
const repoRoot = resolve(process.cwd());
const publicDir = resolve(repoRoot, 'apps/site/public');

function loadBudget(): AssetBudget {
  const raw = JSON.parse(readFileSync(resolve(repoRoot, 'perf-budgets.json'), 'utf8')) as {
    assets: AssetBudget;
  };
  return raw.assets;
}

const RASTER_EXT_RE = /\.(png|jpe?g)$/i;

function walkRasters(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkRasters(full));
    else if (entry.isFile() && RASTER_EXT_RE.test(entry.name)) out.push(full);
  }
  return out;
}

const budget = loadBudget();
const exemptions = new Set(budget.webpExemptions);
const findings: Finding[] = [];
const KB = 1024;

if (!existsSync(publicDir)) {
  process.stderr.write(`asset-budget: ${publicDir} not found\n`);
  process.exit(1);
}

for (const file of walkRasters(publicDir).sort()) {
  const rel = file.slice(publicDir.length + 1);
  if (exemptions.has(rel) || exemptions.has(basename(file))) continue;
  const sizeBytes = statSync(file).size;
  if (sizeBytes <= budget.maxImageKbWithoutWebp * KB) continue;
  const webpCompanion = file.replace(RASTER_EXT_RE, '.webp');
  if (existsSync(webpCompanion)) continue;
  findings.push({
    path: rel,
    sizeKb: Number((sizeBytes / KB).toFixed(2)),
    reason: `> ${budget.maxImageKbWithoutWebp} KB and no sibling ${basename(webpCompanion)}`,
  });
}

if (asJson) {
  process.stdout.write(
    JSON.stringify({ ok: findings.length === 0, budget, findings }, null, 2) + '\n',
  );
} else if (findings.length === 0) {
  process.stdout.write(`asset-budget: ok (public/ raster usage within budget)\n`);
} else {
  for (const f of findings) {
    process.stderr.write(`  ${f.path}: ${f.sizeKb} KB — ${f.reason}\n`);
  }
  process.stderr.write(
    `asset-budget: ${findings.length} oversize raster(s) without WebP companion. Generate via \`cwebp <path>\` or add to webpExemptions in perf-budgets.json.\n`,
  );
}

process.exit(findings.length === 0 ? 0 : 1);
