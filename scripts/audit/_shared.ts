import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROD_ORIGIN = 'https://lasvegasfortransit.org';

export function distHtmlFiles(distDir: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else if (full.endsWith('.html')) out.push(full);
    }
  }
  walk(distDir);
  return out.sort();
}

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
