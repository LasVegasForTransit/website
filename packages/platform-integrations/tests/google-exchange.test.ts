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
    assert.equal(init.redirect, 'manual');
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

void test('a Google token redirect is refused without forwarding the authorization code', async () => {
  const { exchangeGoogleCode } = await import('../src/google-identity');
  const requests: { url: string; redirect: RequestInit['redirect'] }[] = [];
  await assert.rejects(
    exchangeGoogleCode(
      {
        code: 'fixture-private-code',
        verifier: 'verifier',
        callbackUrl: 'https://staff-preview.lasvegasfortransit.org/sign-in/google/callback',
        clientId: 'fixture',
        clientSecret: 'fixture-private-secret',
      },
      (input, init) => {
        requests.push({
          url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          redirect: init?.redirect,
        });
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { Location: 'https://attacker.example.invalid/' },
          }),
        );
      },
    ),
  );
  assert.deepEqual(requests, [{ url: 'https://oauth2.googleapis.com/token', redirect: 'manual' }]);
});

for (const [responseBody, reason] of [
  [
    { error: 'invalid_client', error_description: 'fixture-secret-person@example.invalid' },
    'invalid_client',
  ],
  [{ error: 'invalid_grant' }, 'invalid_grant'],
  [{ error: 'fixture-secret-person@example.invalid' }, 'rejected'],
  [null, 'rejected'],
] as const) {
  void test(`a rejected exchange exposes only a recognized reason: ${reason}`, async () => {
    const { exchangeGoogleCode } = await import('../src/google-identity');
    await assert.rejects(
      exchangeGoogleCode(
        {
          code: 'fixture-private-code',
          verifier: 'fixture-private-verifier',
          callbackUrl: 'https://staff-preview.lasvegasfortransit.org/sign-in/google/callback',
          clientId: 'fixture',
          clientSecret: 'fixture-private-secret',
        },
        () => Promise.resolve(Response.json(responseBody, { status: 400 })),
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok('status' in error && 'reason' in error);
        assert.equal(error.status, 400);
        assert.equal(error.reason, reason);
        assert.equal(error.message, 'Google sign-in exchange failed');
        assert.equal(JSON.stringify(error).includes('fixture-'), false);
        return true;
      },
    );
  });
}

void test('oversized rejection bodies are cancelled without parsing or retaining their contents', async () => {
  const { exchangeGoogleCode } = await import('../src/google-identity');
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(8192));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    exchangeGoogleCode(
      {
        code: 'code',
        verifier: 'verifier',
        callbackUrl: 'https://staff-preview.lasvegasfortransit.org/sign-in/google/callback',
        clientId: 'fixture',
        clientSecret: 'fixture-private-secret',
      },
      () => Promise.resolve(new Response(body, { status: 400 })),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error && 'reason' in error);
      assert.equal(error.reason, 'rejected');
      return true;
    },
  );
  assert.equal(cancelled, true);
});
