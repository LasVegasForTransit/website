import assert from 'node:assert/strict';
import test from 'node:test';
import { MetadataClient } from '../scripts/preflight-api';
import { ReleaseDiagnosticError } from '../scripts/release-diagnostics';

const version = '11111111-2222-4333-8444-555555555555';
const path = `/workers/scripts/lvbt-staff-preview/versions/${version}`;
const missing = () =>
  Response.json({ success: false, errors: [{ code: 100146 }] }, { status: 404 });

void test('an uploaded version can become readable without another upload or a different version', async () => {
  const urls: string[] = [],
    delays: number[] = [];
  const client = new MetadataClient({
    accountId: 'fixture',
    token: 'fixture',
    wait: (milliseconds) => {
      delays.push(milliseconds);
      return Promise.resolve();
    },
    fetch: (url) => {
      assert.ok(typeof url === 'string');
      urls.push(url);
      return Promise.resolve(
        urls.length < 3 ? missing() : Response.json({ success: true, result: { id: version } }),
      );
    },
  });
  assert.deepEqual(await client.get(path, { uploadedVersion: true }), { id: version });
  assert.equal(urls.length, 3);
  assert.equal(new Set(urls).size, 1);
  assert.equal(delays.length, 2);
});

void test('a permanently missing uploaded version fails after a bounded wait', async () => {
  const delays: number[] = [];
  let requests = 0;
  const client = new MetadataClient({
    accountId: 'fixture',
    token: 'fixture',
    wait: (milliseconds) => {
      delays.push(milliseconds);
      return Promise.resolve();
    },
    fetch: () => {
      requests++;
      return Promise.resolve(missing());
    },
  });
  await assert.rejects(client.get(path, { uploadedVersion: true }), ReleaseDiagnosticError);
  assert.ok(requests > 1 && requests <= 10);
  assert.ok(delays.reduce((sum, delay) => sum + delay, 0) <= 120_000);
});

void test('ordinary reads and permission errors never wait for propagation', async () => {
  for (const [uploadedVersion, status, code] of [
    [false, 404, 100146],
    [true, 403, 10000],
    [true, 404, 10007],
  ] as const) {
    let requests = 0;
    const client = new MetadataClient({
      accountId: 'fixture',
      token: 'fixture',
      wait: () => {
        assert.fail('unexpected wait');
      },
      fetch: () => {
        requests++;
        return Promise.resolve(Response.json({ success: false, errors: [{ code }] }, { status }));
      },
    });
    await assert.rejects(client.get(path, { uploadedVersion }), ReleaseDiagnosticError);
    assert.equal(requests, 1);
  }
});
