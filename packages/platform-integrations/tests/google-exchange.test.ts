import assert from 'node:assert/strict';
import test from 'node:test';
void test('Google code exchange uses the fixed endpoint, PKCE, a bounded request and no refresh scope', async () => {
  const loaded = await import('../src/google-identity');
  assert.ok('exchangeGoogleCode' in loaded, 'Google authorization codes need a PKCE exchange');
  const fetcher: typeof fetch = (input, init) => {
    assert.equal(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      'https://oauth2.googleapis.com/token',
    );
    assert.equal(init?.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal);
    const form = (assert.ok(init.body instanceof URLSearchParams), init.body);
    assert.equal(form.get('code'), 'one-use-code');
    assert.equal(form.get('code_verifier'), 'browser-verifier');
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(
      form.get('redirect_uri'),
      'https://lasvegasfortransit.org/sign-in/google/callback',
    );
    assert.equal(form.has('scope'), false);
    return Promise.resolve(
      Response.json({ id_token: 'signed-id-token', access_token: 'never-retained' }),
    );
  };
  const result = await loaded.exchangeGoogleCode(
    {
      code: 'one-use-code',
      verifier: 'browser-verifier',
      callbackUrl: 'https://lasvegasfortransit.org/sign-in/google/callback',
      clientId: 'fixture',
      clientSecret: 'fixture-secret',
    },
    fetcher,
  );
  assert.equal(result, 'signed-id-token');
});
void test('failed Google exchanges fail closed', async () => {
  const { exchangeGoogleCode } = await import('../src/google-identity');
  await assert.rejects(
    exchangeGoogleCode(
      {
        code: 'code',
        verifier: 'verifier',
        callbackUrl: 'https://lasvegasfortransit.org/sign-in/google/callback',
        clientId: 'fixture',
        clientSecret: 'fixture-secret',
      },
      () => Promise.resolve(Response.json({ error: 'invalid_grant' }, { status: 400 })),
    ),
  );
});
