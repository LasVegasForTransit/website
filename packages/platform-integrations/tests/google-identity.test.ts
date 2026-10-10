import assert from 'node:assert/strict';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const now = new Date('2026-10-04T12:00:00Z');
const keys = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'google-test-key', alg: 'RS256' };
const fetcher: typeof fetch = (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs');
  return Promise.resolve(Response.json({ keys: [jwk] }));
};
const valid = {
  iss: 'https://accounts.google.com',
  aud: 'lvbt-client',
  sub: 'stable-google-subject',
  email: 'volunteer@lasvegasfortransit.org',
  email_verified: true,
  hd: 'lasvegasfortransit.org',
  nonce: 'request-nonce',
  given_name: 'Ana',
  family_name: 'Example',
  iat: now.getTime() / 1000,
  exp: now.getTime() / 1000 + 3600,
};
async function token(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .sign(keys.privateKey);
}
async function verifier() {
  const loaded = await import('../src/google-identity').catch(() => null);
  assert.ok(loaded, 'Google verification must exist before linking a Workspace identity');
  return loaded.verifyGoogleIdToken;
}

void test('a verified Workspace token returns the stable identity without granting membership', async () => {
  const verify = await verifier();
  assert.deepEqual(
    await verify(await token(valid), {
      clientId: 'lvbt-client',
      nonce: 'request-nonce',
      now,
      fetch: fetcher,
    }),
    {
      subject: 'stable-google-subject',
      email: 'volunteer@lasvegasfortransit.org',
      givenName: 'Ana',
      familyName: 'Example',
    },
  );
});

for (const [name, changed] of [
  ['wrong issuer', { iss: 'https://attacker.example' }],
  ['wrong audience', { aud: 'other-client' }],
  ['expired token', { exp: now.getTime() / 1000 }],
  ['missing expiry', { exp: undefined }],
  ['missing subject', { sub: undefined }],
  ['non-text subject', { sub: 123 }],
  ['wrong hosted domain', { hd: 'other.org' }],
  ['personal Gmail address', { email: 'volunteer@gmail.com' }],
  ['unverified email', { email_verified: false }],
  ['different nonce', { nonce: 'different-request' }],
  ['different authorized party', { azp: 'other-client' }],
] as const) {
  void test(`Google sign-in refuses ${name}`, async () => {
    const verify = await verifier();
    await assert.rejects(
      verify(await token({ ...valid, ...changed }), {
        clientId: 'lvbt-client',
        nonce: 'request-nonce',
        now,
        fetch: fetcher,
      }),
    );
  });
}

void test('a token signed by another key cannot link an account', async () => {
  const verify = await verifier();
  const other = await generateKeyPair('RS256');
  const forged = await new SignJWT(valid)
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .sign(other.privateKey);
  await assert.rejects(
    verify(forged, {
      clientId: 'lvbt-client',
      nonce: 'request-nonce',
      now,
      fetch: fetcher,
    }),
  );
});
