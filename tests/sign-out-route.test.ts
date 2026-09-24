import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as signOutRoute from '../functions/sign-out/index';

void test('canonicalizes the sign-out GET with a permanent redirect', async () => {
  const handler: unknown = Reflect.get(signOutRoute, 'onRequestGet');
  assert.equal(typeof handler, 'function');

  const response = await (
    handler as (context: {
      request: Request;
      next: () => Promise<Response>;
    }) => Response | Promise<Response>
  )({
    request: new Request('https://lasvegasfortransit.org/sign-out'),
    next: () => Promise.resolve(new Response('page')),
  });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), '/sign-out/');
  assert.equal(
    response.headers.get('strict-transport-security'),
    'max-age=63072000; includeSubDomains; preload',
  );
});

void test('serves the canonical sign-out page without redirecting it to itself', async () => {
  const handler: unknown = Reflect.get(signOutRoute, 'onRequestGet');
  const page = new Response('signed out');
  const response = await (
    handler as (context: {
      request: Request;
      next: () => Promise<Response>;
    }) => Response | Promise<Response>
  )({
    request: new Request('https://lasvegasfortransit.org/sign-out/'),
    next: () => Promise.resolve(page),
  });
  assert.equal(response, page);
});
