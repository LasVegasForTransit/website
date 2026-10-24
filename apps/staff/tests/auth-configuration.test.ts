import assert from 'node:assert/strict';
import test from 'node:test';
import {
  staffAuthMode,
  staffOriginAllowed,
  staffAuthBindings,
} from '@lasvegasfortransit/platform-integrations/staff-auth-config';

void test('authentication mode is explicit and invalid configuration fails closed', () => {
  assert.equal(staffAuthMode({}), 'cloudflare-access');
  assert.equal(staffAuthMode({ LVBT_STAFF_AUTH_MODE: 'google' }), 'google');
  assert.equal(staffAuthMode({ LVBT_STAFF_AUTH_MODE: 'cloudflare-access' }), 'cloudflare-access');
  assert.equal(staffAuthMode({ LVBT_STAFF_AUTH_MODE: '' }), null);
  assert.equal(staffAuthMode({ LVBT_STAFF_AUTH_MODE: 'auto' }), null);
});
void test('portable canonical and preview origins require exact HTTPS origins', () => {
  const env = {
    LVBT_STAFF_ORIGIN: 'https://staff.example.org',
    LVBT_STAFF_PREVIEW_ORIGINS: '["https://preview.example.org"]',
  };
  assert.equal(staffOriginAllowed(env, 'https://staff.example.org'), true);
  assert.equal(staffOriginAllowed(env, 'https://preview.example.org'), true);
  for (const origin of [
    'https://staff.lasvegasfortransit.org',
    'https://attacker.example',
    'http://staff.example.org',
  ])
    assert.equal(staffOriginAllowed(env, origin), false);
  for (const origin of [
    'https://user:password@staff.example.org',
    'https://staff.example.org/path',
    'http://staff.example.org',
  ])
    assert.equal(staffOriginAllowed({ LVBT_STAFF_ORIGIN: origin }, origin), false);
  assert.equal(
    staffOriginAllowed(
      { ...env, LVBT_STAFF_PREVIEW_ORIGINS: 'invalid' },
      'https://preview.example.org',
    ),
    false,
  );
});
void test('required credentials follow the selected mode without requiring unused providers', () => {
  assert.deepEqual(staffAuthBindings({}), [
    'LVBT_SIGN_IN_SECRET',
    'LVBT_RESEND_API_KEY',
    'LVBT_ACCESS_TEAM_DOMAIN',
    'LVBT_ACCESS_AUD',
  ]);
  assert.deepEqual(staffAuthBindings({ LVBT_STAFF_AUTH_MODE: 'google' }), [
    'LVBT_SIGN_IN_SECRET',
    'LVBT_RESEND_API_KEY',
    'LVBT_GOOGLE_OAUTH_CLIENT_ID',
    'LVBT_GOOGLE_OAUTH_CLIENT_SECRET',
  ]);
  assert.equal(staffAuthBindings({ LVBT_STAFF_AUTH_MODE: 'auto' }), null);
});

void test('direct Google callback uses the configured portable staff origin', async () => {
  const { memoryDb } = await import('@lasvegasfortransit/platform-storage/test-db');
  const { startGoogleSignIn } =
    await import('@lasvegasfortransit/platform-integrations/google-sign-in');
  const db = memoryDb();
  const response = await startGoogleSignIn(
    {
      PLATFORM_DB: db,
      LVBT_SIGN_IN_SECRET: 'fixture-only',
      LVBT_STAFF_AUTH_MODE: 'google',
      LVBT_STAFF_ORIGIN: 'https://staff.example.org',
      LVBT_GOOGLE_OAUTH_CLIENT_ID: 'fixture-client',
      LVBT_GOOGLE_OAUTH_CLIENT_SECRET: 'fixture-secret',
    },
    new Request('https://staff.example.org/sign-in/google/?next=%2Fpaper%2F'),
  );
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get('Location') ?? '');
  assert.equal(location.origin, 'https://accounts.google.com');
  assert.equal(
    location.searchParams.get('redirect_uri'),
    'https://staff.example.org/sign-in/google/callback',
  );
  db.raw.close();
});
