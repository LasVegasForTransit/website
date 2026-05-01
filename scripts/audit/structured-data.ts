#!/usr/bin/env tsx
/**
 * Validate JSON-LD structured data in every built HTML page.
 *
 * Checks:
 *  - Each page has at least one <script type="application/ld+json">
 *  - Each script body parses as JSON
 *  - Each parsed object has @context (schema.org) and @type
 *  - The Organization schema (emitted by BaseLayout) appears on every page
 *
 * Usage: tsx scripts/audit/structured-data.ts [--dist=path] [--json]
 *   exit 0 = clean, exit 1 = problems printed
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { distHtmlFiles, relFromDist } from './_shared.js';

interface Finding {
  page: string;
  problem: string;
}

const args = new Map(
  process.argv.slice(2).map((a) => a.split('=') as [string, string | undefined]),
);
const distDir = resolve(args.get('--dist') ?? './dist');
const asJson = args.has('--json');

const SCRIPT_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g;
const findings: Finding[] = [];

for (const file of distHtmlFiles(distDir)) {
  const page = relFromDist(distDir, file);
  const html = readFileSync(file, 'utf8');
  const blocks = [...html.matchAll(SCRIPT_RE)].map((m) => m[1] ?? '');

  if (blocks.length === 0) {
    findings.push({ page, problem: 'no JSON-LD <script> blocks found' });
    continue;
  }

  let hasOrg = false;
  for (const [idx, raw] of blocks.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch (err) {
      findings.push({ page, problem: `block #${idx} not valid JSON: ${(err as Error).message}` });
      continue;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (typeof item !== 'object' || item === null) {
        findings.push({ page, problem: `block #${idx} not an object` });
        continue;
      }
      const obj = item as Record<string, unknown>;
      if (obj['@context'] !== 'https://schema.org') {
        findings.push({ page, problem: `block #${idx} missing @context=https://schema.org` });
      }
      if (typeof obj['@type'] !== 'string') {
        findings.push({ page, problem: `block #${idx} missing @type` });
      }
      if (obj['@type'] === 'Organization') hasOrg = true;
    }
  }

  if (!hasOrg) findings.push({ page, problem: 'missing Organization schema (BaseLayout default)' });
}

if (asJson) {
  process.stdout.write(JSON.stringify({ ok: findings.length === 0, findings }, null, 2) + '\n');
} else if (findings.length === 0) {
  process.stdout.write(`structured-data: ok (${distHtmlFiles(distDir).length} pages checked)\n`);
} else {
  for (const f of findings) process.stderr.write(`  ${f.page}: ${f.problem}\n`);
  process.stderr.write(`structured-data: ${findings.length} problem(s)\n`);
}
process.exit(findings.length === 0 ? 0 : 1);
