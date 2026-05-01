#!/usr/bin/env tsx
/**
 * Scan built HTML for third-party origins in script/link/img/iframe sources.
 *
 * Per the LVBT social policy (Instagram + Bluesky only) and the no-trackers
 * commitment, anything that isn't 'self' should be a known, intentional
 * external dependency. This script reports every distinct off-origin host
 * found in the built HTML so we can audit it during the baseline.
 *
 * Usage: tsx scripts/audit/third-party-scan.ts [--dist=path] [--json]
 *   exit 0 always — this is a reporting tool, not a gate.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { distHtmlFiles, relFromDist } from './_shared.js';

const args = new Map(
  process.argv.slice(2).map((a) => a.split('=') as [string, string | undefined]),
);
const distDir = resolve(args.get('--dist') ?? './dist');
const asJson = args.has('--json');

const ATTR_RE = /(?:src|href)=["'](https?:\/\/[^"']+)["']/g;
const SELF_HOSTS = new Set(['lasvegasfortransit.org', 'www.lasvegasfortransit.org']);

const byHost = new Map<string, Set<string>>();

for (const file of distHtmlFiles(distDir)) {
  const page = relFromDist(distDir, file);
  const html = readFileSync(file, 'utf8');
  for (const m of html.matchAll(ATTR_RE)) {
    const url = m[1];
    if (!url) continue;
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      continue;
    }
    if (SELF_HOSTS.has(host)) continue;
    if (!byHost.has(host)) byHost.set(host, new Set());
    byHost.get(host)!.add(page);
  }
}

const summary = [...byHost.entries()]
  .map(([host, pages]) => ({ host, pageCount: pages.size, samplePages: [...pages].slice(0, 3) }))
  .sort((a, b) => b.pageCount - a.pageCount);

if (asJson) {
  process.stdout.write(JSON.stringify({ thirdPartyHosts: summary }, null, 2) + '\n');
} else if (summary.length === 0) {
  process.stdout.write('third-party-scan: no off-origin sources found\n');
} else {
  process.stdout.write(`third-party-scan: ${summary.length} off-origin host(s)\n`);
  for (const { host, pageCount, samplePages } of summary) {
    process.stdout.write(
      `  ${host}  (${pageCount} page${pageCount === 1 ? '' : 's'}; e.g. ${samplePages.join(', ')})\n`,
    );
  }
}
