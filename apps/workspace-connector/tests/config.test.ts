import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config';
import { config } from './support/runtime';

void test('connector configuration rejects a legacy delegated administrator', () => {
  assert.throws(() =>
    loadConfig({
      WORKSPACE_CONNECTOR_CONFIG: JSON.stringify({
        ...config,
        delegatedAdmin: 'legacy-admin@example.org',
      }),
    }),
  );
});
