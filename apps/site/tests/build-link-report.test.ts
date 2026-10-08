import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildLinkReport, mergeExternalReport } from '../scripts/audit/build-link-report';
const directory = await mkdtemp(path.join(tmpdir(), 'lvbt-build-links-'));
after(() => rm(directory, { recursive: true, force: true }));
void test('combined internal and external results name each failure and count checked URLs', () => {
  const merged = mergeExternalReport(
    {
      checked: 2,
      external: ['https://outside.test/missing'],
      results: [
        {
          url: 'http://127.0.0.1:1234/missing',
          source: '/',
          status: 'fail',
          diagnostic: 'HTTP 404',
        },
      ],
    },
    {
      total: 3,
      errors: 1,
      error_map: {
        'docs/guide.md': [
          { url: 'https://outside.test/missing', status: { code: 404, text: 'Not Found' } },
        ],
      },
    },
  );
  assert.equal(merged.checked, 5);
  assert.equal(merged.results.length, 2);
  assert.equal(merged.results[1]?.source, 'docs/guide.md');
  assert.match(merged.results[1]?.diagnostic ?? '', /404.*Not Found/);
});
void test('malformed lychee output cannot turn missing external evidence into pass', () => {
  assert.throws(
    () => mergeExternalReport({ checked: 1, results: [], external: [] }, { total: 0, errors: 0 }),
    /evidence/,
  );
  assert.throws(
    () => mergeExternalReport({ checked: 1, results: [], external: [] }, { total: 2, errors: 1 }),
    /concrete/,
  );
});
void test('compiled source pages stay attached to broken internal routes', async () => {
  await writeFile(
    path.join(directory, 'index.html'),
    '<a href="/missing">Missing</a><a href="https://outside.test">External</a>',
  );
  const report = await buildLinkReport(directory, 'http://127.0.0.1:1234', () =>
    Promise.resolve(new Response('', { status: 404 })),
  );
  assert.equal(report.checked, 1);
  assert.equal(report.results[0]?.source, '/');
  assert.equal(report.results[0]?.url, 'http://127.0.0.1:1234/missing');
  assert.deepEqual(report.external, ['https://outside.test/']);
});
void test('production uses current public evidence and never invokes the compiled Worker', async () => {
  const { selectLinkReport } = await import('../scripts/audit/build-link-report');
  const expected = { checked: 1, results: [], external: [] };
  let publicCalls = 0;
  assert.equal(
    await selectLinkReport('production', {
      local: () => {
        throw new Error('Compiled Worker must not run in production.');
      },
      production: () => {
        publicCalls++;
        return Promise.resolve(expected);
      },
    }),
    expected,
  );
  assert.equal(publicCalls, 1);
  await assert.rejects(
    selectLinkReport('production', {
      local: () => Promise.resolve(expected),
      production: () => Promise.reject(new Error('Public origin unavailable.')),
    }),
    /Public origin unavailable/,
  );
});
void test('local uses compiled Worker evidence and never invokes the public origin', async () => {
  const { selectLinkReport } = await import('../scripts/audit/build-link-report');
  const expected = { checked: 1, results: [], external: [] };
  assert.equal(
    await selectLinkReport('local', {
      local: () => Promise.resolve(expected),
      production: () => {
        throw new Error('Public origin must not run locally.');
      },
    }),
    expected,
  );
});
