import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import {
  googleCallback,
  startGoogleSignIn,
  STATE_COOKIE,
  type GoogleSignInEnv,
} from '../src/google-sign-in';

function environment(extra: Partial<GoogleSignInEnv> = {}) {
  return {
    PLATFORM_DB: memoryDb(),
    LVBT_SIGN_IN_SECRET: 'fixture-only-secret',
    LVBT_GOOGLE_OAUTH_CLIENT_ID: 'fixture-client-id',
    LVBT_GOOGLE_OAUTH_CLIENT_SECRET: 'fixture-client-secret',
    ...extra,
  };
}

void test('Google sign-in rejects unapproved preview hosts and allows only the configured preview origin', async () => {
  const db = memoryDb();
  const env = environment({ PLATFORM_DB: db });
  const arbitrary = await startGoogleSignIn(
    env,
    new Request('https://staff-preview-attacker.workers.dev/sign-in/google/'),
  );
  assert.equal(arbitrary.status, 403);
  assert.equal(arbitrary.headers.get('Set-Cookie'), null);

  const previewOrigin = 'https://branch-lvbt-staff-preview.lvbt.workers.dev';
  const approved = await startGoogleSignIn(
    {
      ...env,
      LVBT_GOOGLE_PREVIEW_ORIGINS: JSON.stringify([previewOrigin]),
    },
    new Request(`${previewOrigin}/sign-in/google/`),
  );
  assert.equal(approved.status, 303);
  assert.equal(
    new URL(approved.headers.get('Location') ?? '').searchParams.get('redirect_uri'),
    'https://preview.lasvegasfortransit.org/sign-in/google/callback',
  );
  db.raw.close();
});

void test('cancelled Google sign-in clears its cookie and a replay cannot create a session', async () => {
  const db = memoryDb();
  const previewOrigin = 'https://branch-lvbt-staff-preview.lvbt.workers.dev';
  const env = environment({
    PLATFORM_DB: db,
    LVBT_GOOGLE_PREVIEW_ORIGINS: JSON.stringify([previewOrigin]),
  });
  const started = await startGoogleSignIn(
    env,
    new Request(`${previewOrigin}/sign-in/google/?next=%2Fpeople%2F`),
  );
  const state = new URL(started.headers.get('Location') ?? '').searchParams.get('state');
  assert.ok(state);
  const providerCallback = `https://preview.lasvegasfortransit.org/sign-in/google/callback?${new URLSearchParams(
    {
      state,
      error: 'access_denied',
    },
  ).toString()}`;

  const returned = await googleCallback(env, new Request(providerCallback));
  const cancellationUrl = returned.headers.get('Location');
  assert.ok(cancellationUrl);
  assert.equal(new URL(cancellationUrl).origin, previewOrigin);
  assert.equal(new URL(cancellationUrl).searchParams.get('cancelled'), '1');

  const cancelled = await googleCallback(
    env,
    new Request(cancellationUrl, { headers: { cookie: `${STATE_COOKIE}=${state}` } }),
  );
  assert.equal(cancelled.headers.get('Location'), '/sign-in/?google_error=1');
  assert.match(cancelled.headers.get('Set-Cookie') ?? '', new RegExp(`^${STATE_COOKIE}=`));
  assert.match(cancelled.headers.get('Set-Cookie') ?? '', /Max-Age=0/);

  const replay = await googleCallback(env, new Request(providerCallback));
  assert.equal(replay.status, 303);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM sessions').get()?.n, 0);
  assert.equal(
    db.raw.prepare("SELECT count(*) AS n FROM identities WHERE platform='google_workspace'").get()
      ?.n,
    0,
  );
  db.raw.close();
});
