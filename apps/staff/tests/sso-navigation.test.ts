import assert from 'node:assert/strict';
import test from 'node:test';
import { signedOutCookie, isSignedOut, continueSso } from '../src/lib/sso-navigation';
const origin = 'https://staff.example.org';
const env = {
  LVBT_SIGN_IN_SECRET: 'fixture-secret',
  LVBT_STAFF_AUTH_MODE: 'cloudflare-access',
  LVBT_STAFF_ORIGIN: origin,
};
const principal = {
  issuer: 'https://fixture.cloudflareaccess.com',
  subject: 'access-person',
  email: 'staff@lasvegasfortransit.org',
  expiresAt: new Date(Date.now() + 3600000),
};
void test('signed logout marker survives a valid SSO assertion and is scoped to the principal', async () => {
  const cookie = await signedOutCookie(env, principal);
  const headers = { Cookie: cookie.split(';')[0] };
  assert.equal(
    await isSignedOut(env, new Request(`${origin}/sign-in/`, { headers }), principal),
    true,
  );
  assert.equal(
    await isSignedOut(env, new Request(`${origin}/sign-in/`, { headers }), {
      ...principal,
      subject: 'other',
    }),
    false,
  );
  assert.equal(
    await isSignedOut(
      env,
      new Request(`${origin}/sign-in/`, {
        headers: {
          // Change signed bytes, not unused bits in the final base64 character.
          Cookie: cookie
            .split(';')[0]
            .replace(/\.([A-Za-z0-9_-])/, (_, first: string) => `.${first === 'A' ? 'B' : 'A'}`),
        },
      }),
      principal,
    ),
    false,
  );
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
});
void test('only an explicit same-origin POST with a valid logout marker continues SSO', async () => {
  const cookie = (await signedOutCookie(env, principal)).split(';')[0];
  for (const [method, requestOrigin] of [
    ['GET', origin],
    ['POST', 'https://attacker.example'],
    ['POST', ''],
  ] as const) {
    const response = await continueSso(
      env,
      new Request(`${origin}/sign-in/continue/`, {
        method,
        headers: { Cookie: cookie, Origin: requestOrigin },
      }),
      principal,
    );
    assert.equal(response.status, 403);
  }
  const response = await continueSso(
    env,
    new Request(`${origin}/sign-in/continue/`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin },
      body: new URLSearchParams({ next: '/paper/' }),
    }),
    principal,
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/sign-in/?next=%2Fpaper%2F');
  assert.match(response.headers.get('Set-Cookie') ?? '', /Max-Age=0/);
});

void test('SSO credential renewal cannot outlive the signed-out preference', async () => {
  const cookie = await signedOutCookie(env, {
    ...principal,
    expiresAt: new Date(Date.now() + 1000),
  });
  assert.match(cookie, /Max-Age=2592000;/);
});
