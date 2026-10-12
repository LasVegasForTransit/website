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

void test('keeps the sitemap alias and known event replacements direct', () => {
  const rules = parseRedirects(readFileSync(redirectsPath, 'utf8'));
  assert.deepEqual(rules.get('/sitemap.xml'), {
    destination: '/sitemap-index.xml',
    status: '301',
  });
  for (const [source, destination] of [
    ['2026-07-09-lvbt-general-member-meeting', '2026-07-16-lvbt-general-member-meeting'],
    ['2026-07-11-lvbt-s-first-walk-audit-tbd', '2026-07-11-lvbt-s-first-walk-audit'],
  ]) {
    for (const suffix of ['', '/']) {
      assert.deepEqual(rules.get(`/events/${source}${suffix}`), {
        destination: `/events/${destination}/`,
        status: '301',
      });
    }
    assert.equal(rules.has(`/events/${destination}/`), false);
  }
});

void test('sends renamed Vegas Urbanists occurrences to the same dated social', () => {
  const rules = parseRedirects(readFileSync(redirectsPath, 'utf8'));
  for (const date of [
    '2026-10-15',
    '2026-11-19',
    '2026-12-17',
    '2027-01-21',
    '2027-02-18',
    '2027-03-18',
    '2027-04-15',
    '2027-05-20',
    '2027-06-17',
    '2027-07-15',
    '2027-08-19',
    '2027-09-16',
  ]) {
    for (const suffix of ['', '/']) {
      assert.deepEqual(rules.get(`/events/${date}-vegas-urbanists${suffix}`), {
        destination: `/events/${date}-vegas-urbanist-social-club/`,
        status: '301',
      });
    }
  }
});
