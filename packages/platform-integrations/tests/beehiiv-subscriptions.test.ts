import assert from 'node:assert/strict';
import test from 'node:test';

function address(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : input instanceof URL ? input.href : input;
}

const config = { apiKey: 'test-provider-key', publicationId: 'pub_fixture' };
const subscription = {
  id: 'sub_fixture',
  email: 'member@example.invalid',
  status: 'active',
  created: 1700000000,
};

async function client(fetcher: typeof fetch) {
  const module = await import('../src/beehiiv-subscriptions').catch(() => null);
  assert.ok(module, 'Synchronization needs a verified Beehiiv subscription client');
  return new module.BeehiivSubscriptions(config, { fetcher });
}

void test('reads the exact subscription and keeps creation time separate from observation time', async () => {
  const adapter = await client((input, init) => {
    assert.equal(
      address(input),
      'https://api.beehiiv.com/v2/publications/pub_fixture/subscriptions/sub_fixture',
    );
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${config.apiKey}`);
    assert.equal(init?.redirect, 'manual');
    assert.ok(init.signal);
    return Promise.resolve(Response.json({ data: subscription }));
  });
  const result = await adapter.getById('sub_fixture');
  assert.deepEqual(result, { ok: true, subscription });
  assert.equal(Object.hasOwn(result, 'givenAt'), false);
  assert.equal(Object.hasOwn(result, 'withdrawnAt'), false);
});

void test('email lookup encodes an exact address and validates the returned address', async () => {
  const email = 'member+volunteer@example.invalid';
  const adapter = await client((input) => {
    const url = new URL(address(input));
    assert.equal(
      url.pathname,
      '/v2/publications/pub_fixture/subscriptions/by_email/member%2Bvolunteer%40example.invalid',
    );
    return Promise.resolve(Response.json({ data: { ...subscription, email } }));
  });
  assert.deepEqual(await adapter.getByEmail(email), {
    ok: true,
    subscription: { ...subscription, email },
  });
});

void test('an absent subscription is distinct from a provider failure', async () => {
  const absent = await client(() => Promise.resolve(new Response(null, { status: 404 })));
  assert.deepEqual(await absent.getById('sub_fixture'), { ok: true, subscription: null });
  const unavailable = await client(() => Promise.resolve(new Response(null, { status: 503 })));
  assert.deepEqual(await unavailable.getById('sub_fixture'), {
    ok: false,
    kind: 'provider_error',
    status: 503,
    retryAfterMs: null,
  });
});

void test('rejects mismatched identity, email, unknown status and malformed creation time', async () => {
  for (const data of [
    { ...subscription, id: 'sub_someone_else' },
    { ...subscription, status: 'invented_status' },
    { ...subscription, created: '1700000000' },
    { ...subscription, created: Number.MAX_SAFE_INTEGER },
  ]) {
    const adapter = await client(() => Promise.resolve(Response.json({ data })));
    assert.deepEqual(await adapter.getById('sub_fixture'), {
      ok: false,
      kind: 'invalid_response',
      status: 200,
      retryAfterMs: null,
    });
  }
  const adapter = await client(() =>
    Promise.resolve(
      Response.json({ data: { ...subscription, email: 'someone-else@example.invalid' } }),
    ),
  );
  assert.equal((await adapter.getByEmail(subscription.email)).ok, false);
});

void test('provider rate limits preserve fractional retry timing and omit response contents', async () => {
  const adapter = await client(() =>
    Promise.resolve(
      new Response('private address member@example.invalid', {
        status: 429,
        headers: { 'Retry-After': '1.25' },
      }),
    ),
  );
  const result = await adapter.getById('sub_fixture');
  assert.deepEqual(result, { ok: false, kind: 'provider_error', status: 429, retryAfterMs: 1250 });
  assert.doesNotMatch(JSON.stringify(result), /private|member@example/);
});

void test('activation requires a subsequent read proving that the requested address is active', async () => {
  const methods: string[] = [];
  const adapter = await client((_input, init) => {
    methods.push(init?.method ?? 'GET');
    if (init?.method === 'POST') {
      assert.ok(typeof init.body === 'string');
      assert.deepEqual(JSON.parse(init.body), {
        email: subscription.email,
        reactivate_existing: true,
        send_welcome_email: false,
        double_opt_override: 'off',
        utm_source: 'membership_sync',
      });
      return Promise.resolve(Response.json({ data: { ...subscription, status: 'active' } }));
    }
    return Promise.resolve(Response.json({ data: subscription }));
  });
  assert.deepEqual(await adapter.activate(subscription.email), { ok: true, subscription });
  assert.deepEqual(methods, ['POST', 'GET']);
  const stillPending = await client((_input, init) =>
    Promise.resolve(
      Response.json({
        data: { ...subscription, status: init?.method === 'POST' ? 'active' : 'pending' },
      }),
    ),
  );
  assert.deepEqual(await stillPending.activate(subscription.email), {
    ok: false,
    kind: 'not_confirmed',
    status: 200,
    retryAfterMs: 60_000,
  });
});

void test('deactivation is confirmed only after inactive or absent readback', async () => {
  const methods: string[] = [];
  const adapter = await client((_input, init) => {
    methods.push(init?.method ?? 'GET');
    if (init?.method === 'PATCH') {
      assert.ok(typeof init.body === 'string');
      assert.deepEqual(JSON.parse(init.body), { unsubscribe: true });
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    return Promise.resolve(Response.json({ data: { ...subscription, status: 'inactive' } }));
  });
  assert.deepEqual(await adapter.deactivate('sub_fixture'), {
    ok: true,
    subscription: { ...subscription, status: 'inactive' },
  });
  assert.deepEqual(methods, ['PATCH', 'GET']);
  const unchanged = await client(() => Promise.resolve(Response.json({ data: subscription })));
  assert.equal((await unchanged.deactivate('sub_fixture')).ok, false);
  const removed = await client((_input, init) =>
    Promise.resolve(new Response(null, { status: init?.method === 'PATCH' ? 200 : 404 })),
  );
  assert.deepEqual(await removed.deactivate('sub_fixture'), { ok: true, subscription: null });
});

void test('does not follow redirects or issue a read after a failed mutation', async () => {
  let calls = 0;
  let redirect: RequestInit['redirect'];
  const adapter = await client((_input, init) => {
    calls++;
    redirect = init?.redirect;
    return Promise.resolve(
      new Response(null, { status: 302, headers: { Location: 'https://example.invalid/' } }),
    );
  });
  assert.equal((await adapter.activate(subscription.email)).ok, false);
  assert.equal(calls, 1);
  assert.equal(redirect, 'manual');
});

void test('bounds response body reads and rejects invalid input before contacting Beehiiv', async () => {
  let chunks = 0;
  const adapter = await client(() =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          pull(controller) {
            chunks++;
            controller.enqueue(new Uint8Array(131072));
          },
        }),
      ),
    ),
  );
  assert.equal((await adapter.getById('sub_fixture')).ok, false);
  assert.ok(chunks <= 10);
  let calls = 0;
  const untouched = await client(() => {
    calls++;
    return Promise.resolve(Response.json({ data: subscription }));
  });
  await assert.rejects(() => untouched.getById('../other'));
  await assert.rejects(() => untouched.activate('not an email'));
  assert.equal(calls, 0);
});
