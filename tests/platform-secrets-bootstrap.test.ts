import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLATFORM_SECRETS } from '../scripts/bootstrap/config/platform-secrets.js';
import { canGenerateSecret } from '../scripts/bootstrap/phases/secrets.js';

const transitNewsSecret = PLATFORM_SECRETS.find(
  (secret) => secret.name === 'LVBT_TRANSIT_NEWS_INTAKE_SECRET',
);

if (!transitNewsSecret) throw new Error('Transit news secret is not configured');

void test('bootstrap generates a shared secret only when all targets are known empty', () => {
  assert.equal(
    canGenerateSecret(transitNewsSecret, {
      pages: new Set(),
      worker: new Set(),
      'github:worker-candidate': new Set(),
    }),
    true,
  );
});

void test('bootstrap reuses an existing shared secret when only GitHub is missing it', () => {
  assert.equal(
    canGenerateSecret(transitNewsSecret, {
      pages: new Set([transitNewsSecret.name]),
      worker: new Set([transitNewsSecret.name]),
      'github:worker-candidate': new Set(),
    }),
    false,
  );
});

void test('bootstrap does not generate while a target is unreadable', () => {
  assert.equal(
    canGenerateSecret(transitNewsSecret, {
      pages: null,
      worker: new Set(),
      'github:worker-candidate': new Set(),
    }),
    false,
  );
});
