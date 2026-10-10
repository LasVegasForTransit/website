import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { SECURITY_HEADERS } from '../functions/join/_page';
import { en } from '@lasvegasfortransit/platform-core/messages';

const root = new URL('../', import.meta.url);

function sourceFiles(directory: URL): string[] {
  const files: string[] = [];
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|astro|js|mjs)$/.test(name)) files.push(full);
    }
  };
  walk(directory.pathname);
  return files;
}

function catalogKeys(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (typeof node !== 'object' || node === null) return [];
  if ('other' in node) return [prefix];
  return Object.entries(node).flatMap(([key, value]) =>
    catalogKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}

void test('every catalog key is used and every used key exists', () => {
  const code = ['src/', 'platform/', 'functions/']
    .flatMap((dir) => sourceFiles(new URL(dir, root)))
    .filter((file) => !file.includes('/platform/messages/'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  const used = new Set([...code.matchAll(/\bt\(\s*'([a-zA-Z.]+)'/g)].map((match) => match[1]));
  const defined = new Set(catalogKeys(en));
  const missing = [...used].filter((key) => key && !defined.has(key));
  const unused = [...defined].filter((key) => !used.has(key));
  assert.deepEqual(
    missing,
    [],
    `keys used in code but missing from the catalog: ${missing.join(', ')}`,
  );
  assert.deepEqual(unused, [], `catalog keys used nowhere: ${unused.join(', ')}`);
});

void test('pages built on request send the same security headers as public/_headers', () => {
  const headersFile = readFileSync(new URL('public/_headers', root), 'utf8');
  const block = headersFile.split(/\n(?=\/)/).at(0) ?? '';
  const fromFile = Object.fromEntries<string>(
    [...block.matchAll(/^ {2}([\w-]+): (.+)$/gm)].map((match) => [match[1] ?? '', match[2] ?? '']),
  );
  assert.deepEqual(SECURITY_HEADERS, fromFile);
});
