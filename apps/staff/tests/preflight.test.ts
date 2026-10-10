import assert from 'node:assert/strict';
import test from 'node:test';
import { preflightStaff } from '../scripts/preflight';
import { cloudflareFixture } from './support/preflight';

void test('launch check inventories isolated deployments without confusing configuration with acceptance', async () => {
  const fixture = cloudflareFixture();
  const report = await preflightStaff('preview', fixture.options);
  assert.equal(report.checks.find((check) => check.id === 'staff.database')?.status, 'passed');
  assert.equal(report.checks.find((check) => check.id === 'access.policy')?.status, 'passed');
  assert.equal(report.checks.find((check) => check.id === 'database.migrations')?.status, 'passed');
  assert.equal(
    report.checks
      .filter((check) => !check.id.startsWith('source.'))
      .every((check) => check.status === 'passed'),
    true,
  );
  assert.equal(
    report.acceptance.every((check) => check.status === 'unverified'),
    true,
  );
  assert.equal(JSON.stringify(report).includes('DO-NOT-PRINT'), false);
  assert.equal(
    fixture.requests.some((request) => request.method === 'PUT'),
    false,
  );
});

void test('wrong database, broad second policy and incomplete migrations prevent configuration readiness', async () => {
  const fixture = cloudflareFixture({ unsafe: true });
  const report = await preflightStaff('preview', fixture.options);
  for (const id of ['jobs.database', 'access.policy', 'database.migrations'])
    assert.equal(report.checks.find((check) => check.id === id)?.status, 'failed', id);
});

void test('a later policy page cannot hide a bypass from the launch check', async () => {
  const fixture = cloudflareFixture({ paginatedBypass: true });
  const report = await preflightStaff('preview', fixture.options);
  assert.equal(report.checks.find((check) => check.id === 'access.policy')?.status, 'failed');
  assert.ok(fixture.requests.some((request) => request.url.searchParams.get('page') === '2'));
});

void test('missing credentials make remote requirements unverified without any request', async () => {
  const fixture = cloudflareFixture();
  const report = await preflightStaff('preview', { ...fixture.options, token: undefined });
  assert.equal(report.checks.find((check) => check.id === 'cloudflare.read')?.status, 'unverified');
  for (const id of [
    'staff.deployment',
    'jobs.deployment',
    'staff.domain',
    'jobs.exposure',
    'staff.binding.LVBT_GOOGLE_OAUTH_CLIENT_SECRET',
    'access.policy',
    'database.migrations',
    'discord.configuration',
  ])
    assert.equal(report.checks.find((check) => check.id === id)?.status, 'unverified', id);
  assert.equal(fixture.requests.length, 0);
});

void test('API failures cannot leak response bodies or credential values into the report', async () => {
  const fixture = cloudflareFixture({ denied: true });
  const report = await preflightStaff('preview', fixture.options);
  assert.equal(
    report.checks.some((check) => check.status === 'unverified'),
    true,
  );
  assert.equal(JSON.stringify(report).includes('DO-NOT-PRINT'), false);
});

void test('disabled Discord and mismatched worker configuration fail the launch check', async () => {
  for (const mode of [{ disabled: true }, { mismatch: true }]) {
    const fixture = cloudflareFixture(mode);
    const report = await preflightStaff('preview', fixture.options);
    assert.equal(
      report.checks.find((check) => check.id === 'discord.configuration')?.status,
      'failed',
    );
  }
});

void test('preview cannot pass with mutually matching production Discord settings', async () => {
  const fixture = cloudflareFixture({ productionDiscord: true });
  const report = await preflightStaff('preview', fixture.options);
  assert.equal(
    report.checks.find((check) => check.id === 'discord.configuration')?.status,
    'failed',
  );
});

void test('a safe newest version cannot hide unsafe bindings in another actively served version', async () => {
  const fixture = cloudflareFixture({ mixedVersions: true });
  const report = await preflightStaff('preview', fixture.options);
  assert.equal(report.checks.find((check) => check.id === 'jobs.database')?.status, 'failed');
});

void test('a dashboard-enabled jobs URL or custom domain fails deployed exposure checks', async () => {
  for (const mode of [
    { exposedSubdomain: true },
    { exposedDomain: true },
    { exposedRoute: true },
  ]) {
    const fixture = cloudflareFixture(mode);
    const report = await preflightStaff('preview', fixture.options);
    assert.equal(report.checks.find((check) => check.id === 'jobs.exposure')?.status, 'failed');
  }
});
