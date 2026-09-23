import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareResponses,
  pageIncludesAnalytics,
  parityCases,
} from '../scripts/audit/worker-live-parity';

const securityHeaders = {
  'content-security-policy': "default-src 'self'",
  'permissions-policy': 'camera=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=63072000',
  'x-content-type-options': 'nosniff',
};

void test('accepts equivalent page and redirect responses', async () => {
  const page =
    '<html><head><title>About</title><link rel="canonical" href="https://example.org/about/"></head></html>';
  const reference = new Response(page, {
    status: 200,
    headers: { ...securityHeaders, 'content-type': 'text/html; charset=utf-8' },
  });
  const candidate = new Response(page, {
    status: 200,
    headers: { ...securityHeaders, 'content-type': 'text/html' },
  });

  assert.deepEqual(await compareResponses('/about/', reference, candidate), []);

  const referenceRedirect = new Response(null, {
    status: 301,
    headers: { location: '/go', 'content-type': 'text/plain;charset=UTF-8' },
  });
  const candidateRedirect = new Response(null, {
    status: 301,
    headers: { location: '/go' },
  });
  assert.deepEqual(
    await compareResponses('/get-involved', referenceRedirect, candidateRedirect),
    [],
  );
});

void test('reports response contract differences', async () => {
  const reference = new Response(
    '<html><head><title>About</title><link rel="canonical" href="https://example.org/about/"></head></html>',
    { status: 200, headers: { ...securityHeaders, 'content-type': 'text/html' } },
  );
  const candidate = new Response(
    '<html><head><title>Wrong</title><link rel="canonical" href="https://example.org/wrong/"></head></html>',
    {
      status: 404,
      headers: {
        ...securityHeaders,
        'content-type': 'text/html',
        'x-content-type-options': 'missing',
      },
    },
  );

  const differences = await compareResponses('/about/', reference, candidate);
  assert.deepEqual(differences, [
    '/about/: status differs (Pages 200, Worker 404)',
    '/about/: x-content-type-options differs',
    '/about/: title differs',
    '/about/: canonical URL differs',
  ]);
});

void test('detects the shared analytics integration in built pages', async () => {
  assert.equal(
    await pageIncludesAnalytics(
      '<script src="https://static.cloudflareinsights.com/beacon.min.js"></script>',
    ),
    true,
  );
  assert.equal(
    await pageIncludesAnalytics('<script type="module" src="/_astro/analytics.js"></script>', () =>
      Promise.resolve('const collector = "https://events.lasvegasfortransit.org";'),
    ),
    true,
  );
  assert.equal(await pageIncludesAnalytics('<main>Preview</main>'), false);
});

void test('keeps protected API parity out of pull request previews', () => {
  assert.equal(parityCases().filter(({ pathname }) => pathname.startsWith('/api/')).length, 2);
  assert.equal(
    parityCases(false).some(({ pathname }) => pathname.startsWith('/api/')),
    false,
  );
});
