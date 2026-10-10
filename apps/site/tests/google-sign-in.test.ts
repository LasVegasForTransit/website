import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import {
  issueWorkspaceTicket,
  linkWorkspaceIdentity,
} from '@lasvegasfortransit/platform-storage/workspace-link';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { readSession } from '@lasvegasfortransit/platform-storage/auth';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';

const workspace = {
  subject: 'fixture-subject',
  email: 'ana@lasvegasfortransit.org',
  givenName: 'Ana',
  familyName: 'Example',
};
async function fixture() {
  const loaded = await import('../platform/google-sign-in').catch(() => null);
  assert.ok(loaded, 'Google sign-in needs public handlers');
  const db = memoryDb();
  const env = {
    PLATFORM_DB: db,
    LVBT_SIGN_IN_SECRET: 'fixture-only-secret',
    LVBT_GOOGLE_OAUTH_CLIENT_ID: 'fixture-client',
    LVBT_GOOGLE_OAUTH_CLIENT_SECRET: 'fixture-secret',
  };
  return { ...loaded, db, env };
}
void test('Google authorization starts with PKCE, nonce, scoped state cookie and only identity scopes', async () => {
  const { startGoogleSignIn, db, env } = await fixture();
  const response = await startGoogleSignIn(
    env,
    new Request('https://lasvegasfortransit.org/sign-in/google?next=/account/'),
  );
  const location = new URL(response.headers.get('Location') ?? '');
  assert.equal(location.origin, 'https://accounts.google.com');
  assert.equal(location.searchParams.get('scope'), 'openid email profile');
  assert.equal(location.searchParams.get('hd'), 'lasvegasfortransit.org');
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  const state = location.searchParams.get('state');
  assert.ok(state);
  const stored = db.raw
    .prepare('SELECT verifier,state_hash,nonce FROM workspace_oauth_states')
    .get();
  assert.ok(stored);
  assert.equal(stored.state_hash, await digestToken(state));
  assert.equal(
    location.searchParams.get('code_challenge'),
    await digestToken(String(stored.verifier)),
  );
  assert.match(response.headers.get('Set-Cookie') ?? '', /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  db.raw.close();
});
void test('OAuth refuses arbitrary deployment origins and missing credentials', async () => {
  const { startGoogleSignIn, db, env } = await fixture();
  assert.equal(
    (await startGoogleSignIn(env, new Request('https://attacker.example/sign-in/google'))).status,
    403,
  );
  assert.equal(
    (
      await startGoogleSignIn(
        { ...env, LVBT_GOOGLE_OAUTH_CLIENT_ID: '' },
        new Request('https://lasvegasfortransit.org/sign-in/google'),
      )
    ).status,
    503,
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM workspace_oauth_states').get()?.n, 0);
  db.raw.close();
});
void test('a callback ticket needs the original browser state, cannot replay, and starts a returning twelve-hour staff session', async () => {
  const { googleCallback, STATE_COOKIE, db, env } = await fixture();
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'personal@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  await linkWorkspaceIdentity(db, {
    workspace,
    personId: person.id,
    method: 'self_linked',
    operationId: 'fixture',
  });
  const state = 'a'.repeat(43);
  const ticket = await issueWorkspaceTicket(db, {
    workspace,
    state,
    origin: 'https://lasvegasfortransit.org',
    returnTo: '/account/',
  });
  const url = `https://lasvegasfortransit.org/sign-in/google/callback?ticket=${ticket}&state=${state}`;
  const missing = await googleCallback(env, new Request(url));
  assert.equal(
    new URL(missing.headers.get('Location') ?? '', url).searchParams.has('google_error'),
    true,
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM sessions').get()?.n, 0);
  const request = new Request(url, { headers: { Cookie: `${STATE_COOKIE}=${state}` } });
  const response = await googleCallback(env, request);
  assert.equal(response.headers.get('Location'), '/account/');
  const cookie = response.headers.get('Set-Cookie') ?? '';
  const token = /__Host-lvbt_session=([^;]+)/.exec(cookie)?.[1];
  assert.ok(token);
  assert.equal((await readSession(env, token))?.type, 'staff');
  const replay = await googleCallback(env, request);
  assert.equal(
    new URL(replay.headers.get('Location') ?? '', url).searchParams.has('google_error'),
    true,
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM sessions').get()?.n, 1);
  db.raw.close();
});
void test('a tampered state and cancelled Google consent never create an identity or session', async () => {
  const { googleCallback, db, env } = await fixture();
  for (const query of ['state=wrong&code=code', 'state=wrong&error=access_denied']) {
    const response = await googleCallback(
      env,
      new Request(`https://lasvegasfortransit.org/sign-in/google/callback?${query}`),
    );
    assert.equal(response.status, 303);
  }
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM sessions').get()?.n, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM identities').get()?.n, 0);
  db.raw.close();
});

void test('a preview uses the fixed callback and returns verified claims only to its approved browser', async () => {
  const { startGoogleSignIn, googleCallback, STATE_COOKIE, db, env } = await fixture();
  const origin = 'https://branch-lvbt-website-preview.lvbt.workers.dev';
  const previewEnv = { ...env, LVBT_GOOGLE_PREVIEW_ORIGINS: JSON.stringify([origin]) };
  const started = await startGoogleSignIn(
    previewEnv,
    new Request(`${origin}/sign-in/google?next=/account/`),
  );
  const authorization = new URL(started.headers.get('Location') ?? '');
  const state = authorization.searchParams.get('state');
  assert.ok(state);
  const callback = authorization.searchParams.get('redirect_uri');
  assert.equal(callback, 'https://preview.lasvegasfortransit.org/sign-in/google/callback');
  const nonce = authorization.searchParams.get('nonce');
  assert.ok(nonce);
  const keys = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'preview-key', alg: 'RS256' };
  const token = await new SignJWT({
    hd: 'lasvegasfortransit.org',
    email_verified: true,
    email: workspace.email,
    nonce,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'preview-key' })
    .setIssuer('https://accounts.google.com')
    .setAudience(env.LVBT_GOOGLE_OAUTH_CLIENT_ID)
    .setSubject(workspace.subject)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey);
  const fetcher: typeof fetch = (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://oauth2.googleapis.com/token')
      return Promise.resolve(Response.json({ id_token: token }));
    assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs');
    return Promise.resolve(Response.json({ keys: [jwk] }));
  };
  const relay = await googleCallback(
    previewEnv,
    new Request(`${callback}?state=${state}&code=fixture`),
    fetcher,
  );
  const finishUrl = relay.headers.get('Location');
  assert.ok(finishUrl);
  assert.equal(new URL(finishUrl).origin, origin);
  assert.equal(new URL(finishUrl).searchParams.has('email'), false);
  const stolen = new URL(finishUrl);
  stolen.hostname = 'attacker.example';
  assert.equal((await googleCallback(previewEnv, new Request(stolen))).status, 403);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM workspace_pending_links').get()?.n, 0);
  const finished = await googleCallback(
    previewEnv,
    new Request(finishUrl, { headers: { Cookie: `${STATE_COOKIE}=${state}` } }),
  );
  assert.equal(finished.headers.get('Location'), '/sign-in/link-account/');
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM workspace_pending_links').get()?.n, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM sessions').get()?.n, 0);
  db.raw.close();
});
