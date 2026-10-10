import assert from 'node:assert/strict';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
const now = new Date('2026-10-04T12:00:00Z');
const keys = await generateKeyPair('RS256');
const wrongKeys = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'access-fixture', alg: 'RS256' };
const env = {
  LVBT_ACCESS_TEAM_DOMAIN: 'lvbt.cloudflareaccess.com',
  LVBT_ACCESS_AUD: 'staff-audience',
};
const valid = {
  iss: 'https://lvbt.cloudflareaccess.com',
  aud: ['staff-audience'],
  sub: 'access-subject',
  email: 'ana@lasvegasfortransit.org',
  type: 'app',
  iat: now.getTime() / 1000,
  exp: now.getTime() / 1000 + 3600,
};
const fetcher: typeof fetch = (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  assert.equal(url, 'https://lvbt.cloudflareaccess.com/cdn-cgi/access/certs');
  return Promise.resolve(Response.json({ keys: [jwk] }));
};
async function verifier() {
  const loaded = await import('../src/access-identity').catch(() => null);
  assert.ok(loaded, 'staff entry needs independent Access assertion verification');
  return loaded.verifyAccessAssertion;
}
async function token(claims: Record<string, unknown>, wrongSignature = false) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .sign(wrongSignature ? wrongKeys.privateKey : keys.privateKey);
}
void test('Access signs an LVBT email and retains its own subject without treating it as a Google subject', async () => {
  const verify = await verifier();
  assert.deepEqual(
    await verify(
      new Request('https://staff.lasvegasfortransit.org/', {
        headers: { 'Cf-Access-Jwt-Assertion': await token(valid) },
      }),
      env,
      { now, fetch: fetcher },
    ),
    { email: valid.email, subject: valid.sub },
  );
});
for (const [name, claims, wrongSignature] of [
  ['signature', valid, true],
  ['issuer', { ...valid, iss: 'https://other.cloudflareaccess.com' }, false],
  ['audience', { ...valid, aud: ['other-app'] }, false],
  ['expiry', { ...valid, exp: now.getTime() / 1000 }, false],
  ['domain', { ...valid, email: 'ana@example.org' }, false],
  ['service token', { ...valid, email: undefined }, false],
] as const)
  void test(`Access refuses ${name}`, async () => {
    const verify = await verifier();
    assert.equal(
      await verify(
        new Request('https://alternate.workers.dev/', {
          headers: { 'Cf-Access-Jwt-Assertion': await token(claims, wrongSignature) },
        }),
        env,
        { now, fetch: fetcher },
      ),
      null,
    );
  });
void test('missing assertion or unconfigured Access fails closed', async () => {
  const verify = await verifier();
  assert.equal(
    await verify(new Request('https://staff.lasvegasfortransit.org/'), env, {
      now,
      fetch: fetcher,
    }),
    null,
  );
  assert.equal(
    await verify(
      new Request('https://staff.lasvegasfortransit.org/', {
        headers: { 'Cf-Access-Jwt-Assertion': await token(valid) },
      }),
      { ...env, LVBT_ACCESS_TEAM_DOMAIN: 'attacker.example' },
      { now, fetch: fetcher },
    ),
    null,
  );
});
