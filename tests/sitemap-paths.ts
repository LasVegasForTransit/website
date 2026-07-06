import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ORIGIN = 'https://lasvegasfortransit.org';

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function builtSitemapPaths(importMetaUrl: string): string[] {
  const sitemapPath = resolve(dirname(fileURLToPath(importMetaUrl)), '../dist/sitemap-0.xml');
  const deadline = Date.now() + 5_000;

  while (!existsSync(sitemapPath) && Date.now() < deadline) {
    sleep(100);
  }

  if (!existsSync(sitemapPath)) {
    throw new Error(`No sitemap found at ${sitemapPath}. Did the build finish?`);
  }

  const sitemap = readFileSync(sitemapPath, 'utf8');
  const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => (match[1] ?? '').replace(DEFAULT_ORIGIN, ''))
    .map((path) => path || '/');

  if (paths.length === 0) {
    throw new Error(`No URLs found in ${sitemapPath}. Did the build run?`);
  }

  return paths;
}
