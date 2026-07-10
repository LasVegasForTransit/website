import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
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

function walkHtmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) return walkHtmlFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.html') ? [fullPath] : [];
  });
}

function htmlFileToPath(filePath: string, distDir: string): string {
  const relativePath = relative(distDir, filePath).split(sep).join('/');
  if (relativePath === 'index.html') return '/';
  if (relativePath.endsWith('/index.html')) {
    return `/${relativePath.replace(/\/index\.html$/, '/')}`;
  }
  return `/${relativePath}`;
}

export function builtHtmlPagePaths(importMetaUrl: string): string[] {
  const distDir = resolve(dirname(fileURLToPath(importMetaUrl)), '../dist');
  const sitemapPath = resolve(distDir, 'sitemap-0.xml');
  const deadline = Date.now() + 5_000;

  while (!existsSync(sitemapPath) && Date.now() < deadline) {
    sleep(100);
  }

  if (!existsSync(distDir)) {
    throw new Error(`No dist directory found at ${distDir}. Did the build finish?`);
  }

  const paths = walkHtmlFiles(distDir)
    .filter((filePath) => /<html[\s>]/i.test(readFileSync(filePath, 'utf8')))
    .map((filePath) => htmlFileToPath(filePath, distDir))
    .sort((a, b) => a.localeCompare(b));

  if (paths.length === 0) {
    throw new Error(`No HTML pages found in ${distDir}. Did the build run?`);
  }

  return paths;
}
