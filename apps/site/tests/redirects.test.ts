import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Cloudflare Pages, and the assets-backed Worker that serves the same
// public/_redirects file, read one rule per line as "<path> <destination>
// <status>" (comments start with #). This only checks the campaign rules
// below, not the whole file, so unrelated redirects can come and go freely.
const redirectsPath = join(dirname(fileURLToPath(import.meta.url)), '../public/_redirects');

function parseRedirects(contents: string): Map<string, { destination: string; status: string }> {
  const rules = new Map<string, { destination: string; status: string }>();
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [from, destination, status] = trimmed.split(/\s+/);
    if (from && destination && status) rules.set(from, { destination, status });
  }
  return rules;
}

void test('sends old Week Without Driving links to lvwwd.org', () => {
  const rules = parseRedirects(readFileSync(redirectsPath, 'utf8'));

  for (const path of ['/wwd', '/wwd/', '/week-without-driving', '/week-without-driving/']) {
    const rule = rules.get(path);
    assert.ok(rule, `expected a redirect rule for ${path}`);
    assert.equal(rule.destination, 'https://lvwwd.org/');
    assert.equal(rule.status, '302');
  }
});
