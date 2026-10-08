import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseBrowserCredentials } from '../scripts/deploy/release-access';
const config = {
  previewUrl: 'https://preview.lasvegasfortransit.org',
  productionUrl: 'https://lasvegasfortransit.org',
  previewWorker: 'lvbt-website-preview',
  productionWorker: 'lvbt-website',
  workersDevSubdomain: 'las-vegas-for-better-transit',
};
const env = { CF_ACCESS_CLIENT_ID: 'fixture-id', CF_ACCESS_CLIENT_SECRET: 'fixture-secret' };
void test('Access credentials go only to the configured preview or its account-scoped version URL', () => {
  for (const origin of [
    config.previewUrl,
    'https://abcdef12-lvbt-website-preview.las-vegas-for-better-transit.workers.dev',
  ])
    assert.deepEqual(releaseBrowserCredentials(origin, config, env), {
      clientId: 'fixture-id',
      clientSecret: 'fixture-secret',
    });
});
void test('public candidates and local browser tests omit Access credentials even when configured', () => {
  for (const origin of [
    config.productionUrl,
    'https://abcdef12-lvbt-website.las-vegas-for-better-transit.workers.dev',
    'http://localhost:4321',
    'http://127.0.0.1:4321',
  ])
    assert.equal(releaseBrowserCredentials(origin, config, env), undefined);
});
void test('foreign accounts, wrong Workers and arbitrary remote origins fail before authentication', () => {
  for (const origin of [
    'https://abcdef12-lvbt-website-preview.foreign-account.workers.dev',
    'https://abcdef12-other-worker.las-vegas-for-better-transit.workers.dev',
    'https://example.org',
    'https://preview.lasvegasfortransit.org.attacker.example',
  ])
    assert.throws(() => releaseBrowserCredentials(origin, config, env));
});
