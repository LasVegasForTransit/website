import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import { isProviderSpeculationResponse } from '../scripts/deploy/hosted-preview-protection';

void test('only Cloudflare speculation metadata is outside preview response protection', () => {
  const response = (
    path: string,
    kind = 'other',
    contentType = 'application/speculationrules+json',
  ) => ({
    url: () => `https://preview.example.org${path}`,
    request: () => ({ resourceType: () => kind }),
    headers: () => ({ 'content-type': contentType }),
  });
  assert.equal(isProviderSpeculationResponse(response('/cdn-cgi/speculation')), true);
  for (const path of [
    '/',
    '/favicon.svg',
    '/lvbt-release.json',
    '/cdn-cgi/image/photo',
    '/cdn-cgi/speculation/',
  ]) {
    assert.equal(isProviderSpeculationResponse(response(path)), false, path);
  }
  assert.equal(isProviderSpeculationResponse(response('/cdn-cgi/speculation', 'document')), false);
  assert.equal(
    isProviderSpeculationResponse(response('/cdn-cgi/speculation', 'other', 'text/html')),
    false,
  );
});

void test('Chromium fetches provider speculation metadata once per navigation while site responses remain checked', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/cdn-cgi/speculation') {
      response.writeHead(200, { 'content-type': 'application/speculationrules+json' });
      response.end('{"prefetch":[]}');
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html',
      'speculation-rules': '"/cdn-cgi/speculation"',
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex',
    });
    response.end('<html><body>Candidate</body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const metadata: string[] = [];
    const protectedPaths: string[] = [];
    const failures: string[] = [];
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (isProviderSpeculationResponse(response)) {
        metadata.push(path);
        return;
      }
      protectedPaths.push(path);
      if (response.headers()['cache-control'] !== 'private, no-store')
        failures.push(`${path}: cache`);
      if (!response.headers()['x-robots-tag']?.includes('noindex'))
        failures.push(`${path}: indexing`);
    });
    for (const path of ['/', '/about/', '/missing/']) {
      await page.goto(`http://127.0.0.1:${address.port}${path}`, { waitUntil: 'networkidle' });
    }
    assert.deepEqual(failures, []);
    assert.deepEqual(
      metadata,
      Array.from({ length: 3 }, () => '/cdn-cgi/speculation'),
    );
    assert.deepEqual(protectedPaths, ['/', '/about/', '/missing/']);
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
