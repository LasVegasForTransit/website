import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseBrowserCredentials, verifyReleaseAccess } from '../scripts/deploy/release-access';
const config = {
  previewUrl: 'https://preview.lasvegasfortransit.org',
  productionUrl: 'https://lasvegasfortransit.org',
  previewWorker: 'lvbt-website-preview',
  productionWorker: 'lvbt-website',
  workersDevSubdomain: 'las-vegas-for-better-transit',
};
const env = { CF_ACCESS_CLIENT_ID: 'fixture-id', CF_ACCESS_CLIENT_SECRET: 'fixture-secret' };
void test('Access credentials go only to configured staging and account-scoped version URLs', () => {
  for (const origin of [
    config.previewUrl,
    'https://abcdef12-lvbt-website-preview.las-vegas-for-better-transit.workers.dev',
    'https://abcdef12-lvbt-website.las-vegas-for-better-transit.workers.dev',
  ])
    assert.deepEqual(releaseBrowserCredentials(origin, config, env), {
      clientId: 'fixture-id',
      clientSecret: 'fixture-secret',
    });
});
void test('public production and local browser tests omit Access credentials even when configured', () => {
  for (const origin of [config.productionUrl, 'http://localhost:4321', 'http://127.0.0.1:4321'])
    assert.equal(releaseBrowserCredentials(origin, config, env), undefined);
});
void test('private candidates require a complete Access credential pair', () => {
  for (const origin of [
    config.previewUrl,
    'https://abcdef12-lvbt-website.las-vegas-for-better-transit.workers.dev',
  ]) {
    assert.throws(() => releaseBrowserCredentials(origin, config, {}), /Access credentials/);
    assert.throws(
      () => releaseBrowserCredentials(origin, config, { CF_ACCESS_CLIENT_ID: 'fixture-id' }),
      /both/,
    );
  }
});
void test('foreign accounts, wrong Workers and arbitrary remote origins fail before authentication', () => {
  for (const origin of [
    'https://abcdef12-lvbt-website-preview.foreign-account.workers.dev',
    'https://abcdef12-other-worker.las-vegas-for-better-transit.workers.dev',
    'https://example.org',
    'https://preview.lasvegasfortransit.org.attacker.example',
    'https://abcdef12-lvbt-website.foreign-account.workers.dev',
    'https://abcdef12-lvbt-website.las-vegas-for-better-transit.workers.dev:8443',
    'https://abcdef12-lvbt-website.las-vegas-for-better-transit.workers.dev/path',
  ])
    assert.throws(() => releaseBrowserCredentials(origin, config, env));
});

const candidate = 'https://abcdef12-lvbt-website.las-vegas-for-better-transit.workers.dev';
const challenge = 'https://lvbt.cloudflareaccess.com/cdn-cgi/access/login/candidate';

void test('candidate verification first proves anonymous denial without following redirects', async (t) => {
  const calls: { url: string; options: RequestInit | undefined }[] = [];
  t.mock.method(globalThis, 'fetch', (url: string, options?: RequestInit) => {
    calls.push({ url, options });
    return Promise.resolve(new Response(null, { status: 302, headers: { location: challenge } }));
  });
  assert.deepEqual(await verifyReleaseAccess(candidate, config, {}, env), {
    clientId: 'fixture-id',
    clientSecret: 'fixture-secret',
  });
  assert.deepEqual(calls, [
    { url: `${candidate}/`, options: { headers: {}, redirect: 'manual' } },
    { url: `${candidate}/lvbt-release.json`, options: { headers: {}, redirect: 'manual' } },
  ]);
});

void test('application redirects cannot stand in for an Access challenge', async (t) => {
  for (const location of [
    `${candidate}/about/`,
    'https://foreign.cloudflareaccess.com/cdn-cgi/access/login/candidate',
    'https://lvbt.cloudflareaccess.com.attacker.test/cdn-cgi/access/login/candidate',
    'http://lvbt.cloudflareaccess.com/cdn-cgi/access/login/candidate',
    'https://lvbt.cloudflareaccess.com/about/',
  ]) {
    t.mock.method(globalThis, 'fetch', () =>
      Promise.resolve(new Response(null, { status: 302, headers: { location } })),
    );
    await assert.rejects(verifyReleaseAccess(candidate, config, {}, env), /Anonymous request/);
    t.mock.restoreAll();
  }
});

void test('a protected home page cannot hide a publicly readable release marker', async (t) => {
  t.mock.method(globalThis, 'fetch', (url: string) =>
    Promise.resolve(
      url.endsWith('/lvbt-release.json')
        ? Response.json({ commit: 'fixture', releaseId: 'fixture' })
        : new Response(null, { status: 302, headers: { location: challenge } }),
    ),
  );
  await assert.rejects(verifyReleaseAccess(candidate, config, {}, env), /Anonymous request/);
});

void test('candidate verification rejects public or unavailable candidates', async (t) => {
  for (const status of [200, 301, 302, 404, 500]) {
    t.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(null, { status })));
    await assert.rejects(verifyReleaseAccess(candidate, config, {}, env), /Anonymous request/);
    t.mock.restoreAll();
  }
});

void test('missing credentials and invalid verification modes fail before making requests', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('No network request was expected.');
  });
  await assert.rejects(verifyReleaseAccess(candidate, config, {}, {}), /Access credentials/);
  await assert.rejects(
    verifyReleaseAccess(candidate, config, { public: true }, env),
    /production origin/,
  );
  await assert.rejects(verifyReleaseAccess(config.productionUrl, config, { protected: true }, env));
  await assert.rejects(
    verifyReleaseAccess(candidate, config, { protected: true, public: true }, env),
    /either/,
  );
  assert.equal(fetch.mock.callCount(), 0);
});

void test('public production verification remains anonymous with a configured service pair', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('No Access probe was expected for public production.');
  });
  assert.equal(
    await verifyReleaseAccess(config.productionUrl, config, { public: true }, env),
    undefined,
  );
  assert.equal(fetch.mock.callCount(), 0);
});
