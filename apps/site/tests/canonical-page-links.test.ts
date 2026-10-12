import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCanonicalPageLinks } from '../scripts/audit/canonical-page-links';

const origin = 'http://127.0.0.1:1234';
const canonical = (route: string) =>
  new Response(`<link rel="canonical" href="https://lasvegasfortransit.org${route}">`, {
    headers: { 'content-type': 'text/html' },
  });

void test('all public HTML route families require canonical trailing slashes', async () => {
  for (const href of ['/go', '/programs', '/brand', '/press', '/qr', '/go#newsletter']) {
    await assert.rejects(
      checkCanonicalPageLinks(`<a href="${href}">Page</a>`, '/about/', origin),
      /skips its canonical trailing slash/,
    );
  }
});

void test('same-site absolute anchors require the exact HTTPS apex origin', async () => {
  for (const href of [
    'http://lasvegasfortransit.org/path/',
    'http://www.lasvegasfortransit.org/path/',
    'https://www.lasvegasfortransit.org/path/',
    '//www.lasvegasfortransit.org/path/',
    'http://lasvegasfortransit.org/go#newsletter',
    'http://www.lasvegasfortransit.org/press?source=about',
  ]) {
    await assert.rejects(
      checkCanonicalPageLinks(`<a href="${href}">Page</a>`, '/about/', origin, {
        request: (url) => Promise.resolve(canonical(new URL(url).pathname)),
      }),
      /noncanonical origin/,
    );
  }
});

void test('relative and production-origin anchors resolve, decode queries, and fetch once', async () => {
  const requested: string[] = [];
  const checked = new Set<string>();
  const request = (url: string) => {
    requested.push(url);
    return Promise.resolve(canonical(new URL(url).pathname));
  };
  const html = `<a href='../go/?one=1&amp;two=2#newsletter'>Go</a>
    <a href="https://lasvegasfortransit.org/brand/">Brand</a>
    <a href="//lasvegasfortransit.org/press/">Press</a>`;
  await checkCanonicalPageLinks(html, '/about/', origin, { request, checked });
  await checkCanonicalPageLinks(html, '/about/', origin, { request, checked });
  assert.deepEqual(requested, [
    `${origin}/go/?one=1&two=2`,
    `${origin}/brand/`,
    `${origin}/press/`,
  ]);
});

void test('assets, files, APIs, fragments, and external links are outside the page audit', async () => {
  const html = `<a href="/events/meeting.ics">Calendar</a><a href="/brand/logo.svg">Logo</a>
    <a href="/api/download?token=public">API</a><a href="/cdn-cgi/image/preview">Image</a>
    <a href="https://willie.page">Author</a><a href="mailto:a@example.test">Email</a>
    <a href="#section">Section</a><img src="/image-without-extension">`;
  await checkCanonicalPageLinks(html, '/about/', origin, {
    request: () => {
      assert.fail('Non-page links must not be requested');
    },
  });
});

void test('HTML links must return direct 200 responses with self-canonical metadata', async () => {
  for (const status of [301, 302, 307, 308, 404]) {
    await assert.rejects(
      checkCanonicalPageLinks('<a href="/old/">Old</a>', '/', origin, {
        request: () =>
          Promise.resolve(new Response('', { status, headers: { location: '/current/' } })),
      }),
      /Expected direct 200/,
    );
  }
  await assert.rejects(
    checkCanonicalPageLinks('<a href="/old/">Old</a>', '/', origin, {
      request: () => Promise.resolve(canonical('/current/')),
    }),
    /Expected self-canonical/,
  );
});

void test('protected account links permit only their intentional sign-in gate', async () => {
  await checkCanonicalPageLinks('<a href="/account/">Account</a>', '/', origin, {
    request: () =>
      Promise.resolve(
        new Response('', { status: 303, headers: { location: '/sign-in/?next=%2Faccount%2F' } }),
      ),
  });
  await assert.rejects(
    checkCanonicalPageLinks('<a href="/account/">Account</a>', '/', origin, {
      request: () =>
        Promise.resolve(new Response('', { status: 303, headers: { location: '/go/' } })),
    }),
    /Expected direct 200/,
  );
});
