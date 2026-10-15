import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { verifyReleaseSmoke } from '../scripts/deploy/release-smoke';

void test('candidate and activation smoke include marker and browser resources in their allowances', async () => {
  let received = 0;
  let burst = true;
  let staleMarkers = 0;
  let markerReads = 0;
  const expected = { commit: 'a'.repeat(40), releaseId: '123' };
  const server = createServer((request, response) => {
    received += 1;
    if (request.url === '/lvbt-release.json') {
      markerReads += 1;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify(staleMarkers-- > 0 ? { ...expected, releaseId: '122' } : expected),
      );
      return;
    }
    if (request.url !== '/') {
      response.end();
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end(
      `<html><head><title>Las Vegans for Better Transit</title></head><body><main>Local release</main>${Array.from(
        { length: burst ? 80 : 15 },
        (_, i) => `<img src="/image-${i}">`,
      ).join(
        '',
      )}${burst ? '' : `<script>for (let i=0;i<4;i++) { fetch('/analytics-'+i, {method:'POST',body:'event'}); fetch('/analytics-'+i, {method:'OPTIONS'}); }</script>`}</body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    for (const [waitForPropagation, limit] of [
      [false, 20],
      [true, 32],
    ] as const) {
      received = 0;
      await assert.rejects(
        verifyReleaseSmoke({
          origin,
          expected,
          protected: false,
          public: false,
          waitForPropagation,
        }),
        /Smoke exceeded its hosted request allowance/,
      );
      assert.equal(received, limit, 'No smoke resource can bypass the stage counter.');
    }
    received = 0;
    markerReads = 0;
    burst = false;
    staleMarkers = 4;
    const report = await verifyReleaseSmoke({
      origin,
      expected,
      protected: false,
      public: false,
      waitForPropagation: true,
    });
    assert.equal(
      markerReads,
      5,
      'Activation preserves all five bounded propagation reads without test retries.',
    );
    assert.equal(report.limit, 32);
    assert.equal(report.sent, received);
    assert.equal(report.blocked, 0);
    assert.equal(
      report.sent,
      29,
      'Five markers, sixteen page resources and eight analytics requests are counted.',
    );
    assert.ok(
      report.sent + 2 <= report.limit,
      'The two public nested/canonical HTTP checks still fit.',
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
