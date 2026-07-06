import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PROD_ORIGIN = 'https://lasvegasfortransit.org';

export function distHtmlFiles(distDir: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && full.endsWith('.html')) out.push(full);
    }
  }
  walk(distDir);
  return out.sort();
}

// lighthouserc.cjs duplicates this <loc> parse inline (a .cjs can't import
// this .ts without a loader). Keep both in sync if the sitemap shape changes.
export function sitemapPaths(distDir: string): string[] {
  const xml = readFileSync(join(distDir, 'sitemap-0.xml'), 'utf8');
  const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
  return matches
    .map((m) => (m[1] ?? '').replace(PROD_ORIGIN, ''))
    .map((p) => p || '/')
    .sort();
}

export function relFromDist(distDir: string, file: string): string {
  return file
    .slice(distDir.length)
    .replace(/\/index\.html$/, '/')
    .replace(/\.html$/, '');
}

/**
 * Shared CLI arg parser for the audit scripts. Honors `--dist=<path>` and the
 * boolean `--json` flag, returning the resolved absolute dist directory.
 */
export function parseAuditArgs(argv: string[] = process.argv.slice(2)): {
  distDir: string;
  asJson: boolean;
} {
  const args = new Map(argv.map((a) => a.split('=') as [string, string | undefined]));
  return {
    distDir: resolve(args.get('--dist') ?? './dist'),
    asJson: args.has('--json'),
  };
}
