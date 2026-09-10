import assert from 'node:assert/strict';
import { test } from 'node:test';

import { onRequest } from '../functions/_middleware';

// The middleware only touches the campaign host. Both stubs record whether
// they were called so a test can assert the request took the intended path.
function context(url: string) {
  const calls = { next: 0, assets: [] as string[] };
  const ctx = {
    request: new Request(url),
    env: {
      ASSETS: {
        fetch: async (input: Request | string) => {
          const requestUrl = typeof input === 'string' ? input : input.url;
          calls.assets.push(requestUrl);
          return new Response(`asset:${new URL(requestUrl).pathname}`);
        },
      },
    },
    next: async () => {
      calls.next += 1;
      return new Response('next');
    },
  } as unknown as Parameters<typeof onRequest>[0];
  return { ctx, calls };
}

test('leaves the main site alone', async () => {
  const { ctx, calls } = context('https://lasvegasfortransit.org/wwd/');
  const response = await onRequest(ctx);
  assert.equal(await response.text(), 'next');
  assert.equal(calls.next, 1);
  assert.deepEqual(calls.assets, []);
});

test('redirects www to the apex, keeping the path', async () => {
  const { ctx } = context('https://www.lvwwd.org/?utm_source=x');
  const response = await onRequest(ctx);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), 'https://lvwwd.org/?utm_source=x');
});

test('serves the campaign page at the root of lvwwd.org', async () => {
  const { ctx, calls } = context('https://lvwwd.org/');
  const response = await onRequest(ctx);
  assert.equal(await response.text(), 'asset:/wwd/');
  assert.deepEqual(calls.assets, ['https://lvwwd.org/wwd/']);
  assert.equal(calls.next, 0);
});

test('collapses /wwd on lvwwd.org to the root', async () => {
  for (const path of ['/wwd', '/wwd/']) {
    const { ctx } = context(`https://lvwwd.org${path}`);
    const response = await onRequest(ctx);
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), 'https://lvwwd.org/');
  }
});

test('passes the page assets through on lvwwd.org', async () => {
  for (const path of [
    '/_astro/BaseLayout.abc123.css',
    '/scripts/reveal-on-scroll.js',
    '/favicon.svg',
  ]) {
    const { ctx, calls } = context(`https://lvwwd.org${path}`);
    const response = await onRequest(ctx);
    assert.equal(await response.text(), 'next');
    assert.equal(calls.next, 1);
  }
});

test('answers robots.txt on lvwwd.org without the main sitemap', async () => {
  const { ctx } = context('https://lvwwd.org/robots.txt');
  const response = await onRequest(ctx);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Allow: \//);
});

test('sends every other lvwwd.org path to the main site', async () => {
  const { ctx } = context('https://lvwwd.org/projects/week-without-driving?x=1');
  const response = await onRequest(ctx);
  assert.equal(response.status, 301);
  assert.equal(
    response.headers.get('location'),
    'https://lasvegasfortransit.org/projects/week-without-driving?x=1',
  );
});
