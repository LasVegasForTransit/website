import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkspaceConnector } from '../src/connector';

const config = {
  environment: 'preview' as const,
  customerId: 'C-lvbt',
  origin: 'https://workspace-preview.example.run.app',
  siteAudience: 'https://preview.lasvegasfortransit.org/api/workspace/v1',
  schedulerSubject: '222222222222222222222',
  serviceAccount: 'workspace-preview@lvbt-core.iam.gserviceaccount.com',
  consoleGroupEmail: 'console-preview@lasvegasfortransit.org',
  productionConsoleGroupEmail: 'console-users@lasvegasfortransit.org',
  managedGroups: ['committee-preview@lasvegasfortransit.org'],
  productionGroups: ['committee@lasvegasfortransit.org'],
};
void test('unauthenticated processing requests do not touch Google or portal data', async () => {
  let calls = 0;
  const connector = createWorkspaceConnector(config, {
    fetch: () => {
      calls++;
      return Promise.reject(new Error('must not fetch'));
    },
  });
  const result = await connector.fetch(new Request(`${config.origin}/run`, { method: 'POST' }));
  assert.equal(result.status, 401);
  assert.equal(calls, 0);
});

void test('forged or oversized notifications do not trigger directory reads', async () => {
  let calls = 0;
  const connector = createWorkspaceConnector(config, {
    fetch: () => {
      calls++;
      return Promise.reject(new Error('must not fetch'));
    },
  });
  const missing = await connector.fetch(
    new Request(`${config.origin}/notifications`, {
      method: 'POST',
      body: JSON.stringify({ id: 'victim', primaryEmail: 'victim@lasvegasfortransit.org' }),
    }),
  );
  assert.equal(missing.status, 401);
  const oversized = await connector.fetch(
    new Request(`${config.origin}/notifications`, { method: 'POST', body: 'x'.repeat(65537) }),
  );
  assert.ok([401, 413].includes(oversized.status));
  assert.equal(calls, 0);
});

void test('preview production write targets are refused before network access', () => {
  assert.throws(() =>
    createWorkspaceConnector({ ...config, consoleGroupEmail: config.productionConsoleGroupEmail }),
  );
  assert.throws(() =>
    createWorkspaceConnector({
      ...config,
      siteAudience: 'http://attacker.example/api/workspace/v1',
    }),
  );
});
