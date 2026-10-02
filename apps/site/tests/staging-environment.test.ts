import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldEnable } from '@lasvegasfortransit/analytics';
import {
  accessHeaders,
  accessCredentials,
  accessRequestOptions,
} from '../scripts/deploy/access-auth';
import { deploymentResponse } from '../functions/_middleware';

void test('Access headers are supplied only to the configured HTTPS origin', () => {
  const credentials = { clientId: 'test-id', clientSecret: 'test-secret' };
  const origin = 'https://preview.lasvegasfortransit.org';
  assert.equal(
    accessHeaders(`${origin}/about`, origin, credentials)['CF-Access-Client-Id'],
    'test-id',
  );
  for (const url of [
    'https://example.com/',
    'https://preview.lasvegasfortransit.org.evil.test/',
    'http://preview.lasvegasfortransit.org/',
  ]) {
    assert.deepEqual(accessHeaders(url, origin, credentials), {});
  }
  assert.throws(() => accessCredentials({ CF_ACCESS_CLIENT_ID: 'id' }), /both/);
  assert.equal(accessCredentials({}), undefined);
});

void test('API and browser request options authenticate the target without following redirects', () => {
  const origin = 'https://preview.lasvegasfortransit.org';
  const credentials = { clientId: 'test-id', clientSecret: 'test-secret' };
  assert.deepEqual(accessRequestOptions(`${origin}/sitemap-0.xml`, origin, credentials), {
    headers: { 'CF-Access-Client-Id': 'test-id', 'CF-Access-Client-Secret': 'test-secret' },
    maxRedirects: 0,
  });
  assert.deepEqual(accessRequestOptions('https://example.com/', origin, credentials), {
    headers: {},
    maxRedirects: 0,
  });
  assert.deepEqual(accessRequestOptions('http://localhost/sitemap-0.xml', 'http://localhost'), {
    headers: {},
    maxRedirects: 0,
  });
});

void test('preview responses cannot be indexed or cached, including redirects', () => {
  for (const status of [200, 302, 404]) {
    const response = deploymentResponse(new Response(null, { status }), 'preview');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.status, status);
  }
  const publicResponse = deploymentResponse(new Response('public'), 'production');
  assert.equal(publicResponse.headers.get('x-robots-tag'), null);
});

void test('the same production analytics bundle stays disabled on every preview hostname', () => {
  const input = {
    site: 'lasvegasfortransit.org',
    token: 'public-token',
    pathname: '/',
    gpc: false,
    dnt: false,
    framed: false,
  };
  for (const hostname of [
    'preview.lasvegasfortransit.org',
    'pr-123-lvbt-website-preview.las-vegas-for-better-transit.workers.dev',
  ]) {
    assert.equal(shouldEnable({ ...input, hostname }).enabled, false);
  }
  assert.equal(shouldEnable({ ...input, hostname: 'lasvegasfortransit.org' }).enabled, true);
});
