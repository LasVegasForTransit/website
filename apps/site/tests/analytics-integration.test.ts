import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { csp } from '@lasvegasfortransit/analytics';
import { analyticsIntegrations } from '../src/lib/analytics';

function integrationNames(requireAnalytics: boolean): string[] {
  return analyticsIntegrations(requireAnalytics).map(({ name }) => name);
}

void test('enables LVBT analytics only for the required production build', () => {
  assert.equal(integrationNames(false).includes('@lasvegasfortransit/analytics'), false);
  assert.equal(integrationNames(true).includes('@lasvegasfortransit/analytics'), true);
});

void test('allows every analytics endpoint through the production CSP', async () => {
  const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
  const policy = /Content-Security-Policy:\s*([^\n]+)/.exec(headers)?.[1];
  assert.ok(policy, 'public/_headers must define a Content-Security-Policy');
  assert.deepEqual(csp.check(policy), []);
});
