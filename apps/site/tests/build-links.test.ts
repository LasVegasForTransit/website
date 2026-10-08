import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linksFromHtml, checkInternalLinks } from '../scripts/audit/build-links';
void test('built relative, apex and www links resolve to build routes while external URLs stay external', () => {
  const links = linksFromHtml(
    '<a href="next/">Next</a><a href="/api/events.ics?x=1&amp;y=2">Calendar</a><a href="https://www.lasvegasfortransit.org/events/new/">New</a><img src="/logo.svg"><a href="https://willie.page">Author</a><a href="mailto:a@example.test">Mail</a>',
    '/events/',
    'http://127.0.0.1:1234',
  );
  assert.deepEqual(links.internal, [
    'http://127.0.0.1:1234/events/next/',
    'http://127.0.0.1:1234/api/events.ics?x=1&y=2',
    'http://127.0.0.1:1234/events/new/',
    'http://127.0.0.1:1234/logo.svg',
  ]);
  assert.deepEqual(links.external, ['https://willie.page/']);
});
void test('runtime calendar and redirect endpoints are checked with GET against the build', async () => {
  const paths: string[] = [];
  const external = await checkInternalLinks(
    [
      'http://127.0.0.1:1234/events/new/',
      'http://127.0.0.1:1234/api/events.ics',
      'http://127.0.0.1:1234/go',
    ],
    'http://127.0.0.1:1234',
    (url, options) => {
      paths.push(new URL(url).pathname);
      assert.equal(options.redirect, 'manual');
      return Promise.resolve(
        url.endsWith('/go')
          ? new Response('', { status: 302, headers: { location: 'https://example.test/join' } })
          : new Response('works'),
      );
    },
  );
  assert.deepEqual(paths, ['/events/new/', '/api/events.ics', '/go']);
  assert.deepEqual(external, ['https://example.test/join']);
});
void test('broken built routes and redirects still fail the audit', async () => {
  await assert.rejects(
    checkInternalLinks(['http://127.0.0.1:1234/missing'], 'http://127.0.0.1:1234', () =>
      Promise.resolve(new Response('', { status: 404 })),
    ),
    /404.*missing/,
  );
  await assert.rejects(
    checkInternalLinks(['http://127.0.0.1:1234/loop'], 'http://127.0.0.1:1234', () =>
      Promise.resolve(new Response('', { status: 302, headers: { location: '/loop' } })),
    ),
    /redirect/i,
  );
});

void test('structured build link reports retain every broken route and reports all failures', async () => {
  const { checkInternalLinkResults } = await import('../scripts/audit/build-links');
  assert.equal(typeof checkInternalLinkResults, 'function', 'structured link checker is missing');
  const report = await checkInternalLinkResults(
    ['http://127.0.0.1:1234/one', 'http://127.0.0.1:1234/two'],
    'http://127.0.0.1:1234',
    () => Promise.resolve(new Response('', { status: 404 })),
  );
  assert.equal(report.checked, 2);
  assert.deepEqual(
    report.results.map((result) => result.url),
    ['http://127.0.0.1:1234/one', 'http://127.0.0.1:1234/two'],
  );
  assert.ok(report.results.every((result) => result.status === 'fail'));
});
