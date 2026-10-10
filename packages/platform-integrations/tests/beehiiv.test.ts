import assert from 'node:assert/strict';
import test from 'node:test';
import type { BeehiivConfig } from '../src/beehiiv';

const config: BeehiivConfig = {
  apiKey: 'a'.repeat(32),
  publicationId: 'pub_123',
};

async function listPage(
  inputConfig: BeehiivConfig,
  options: { cursor?: string; limit?: number; now?: () => number },
  fetcher?: typeof fetch,
) {
  const module = await import('../src/beehiiv').catch(() => null);
  assert.ok(module, 'Beehiiv needs a subscription listing adapter');
  assert.equal(typeof module.listSubscriptions, 'function');
  return module.listSubscriptions(inputConfig, options, fetcher);
}

async function listAll(inputConfig: BeehiivConfig, fetcher?: typeof fetch) {
  const module = await import('../src/beehiiv').catch(() => null);
  assert.ok(module, 'Beehiiv needs a subscription listing adapter');
  assert.equal(typeof module.listAllSubscriptions, 'function');
  return module.listAllSubscriptions(inputConfig, {}, fetcher);
}

void test('lists Beehiiv subscriptions by opaque cursor without expanding extra member data', async () => {
  const requested: URL[] = [];
  const authorization: string[] = [];
  const result = await listPage(config, { cursor: 'opaque/cursor?', limit: 25 }, (input, init) => {
    const address =
      input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    requested.push(new URL(address));
    authorization.push(new Headers(init?.headers).get('Authorization') ?? '');
    return Promise.resolve(
      Response.json({
        data: [
          {
            id: 'sub_123',
            email: 'member@example.invalid',
            status: 'active',
            created: 1791540000,
          },
        ],
        has_more: true,
        next_cursor: 'next-page-token',
      }),
    );
  });

  const request = requested[0];
  const authHeader = authorization[0];
  assert.ok(request);
  assert.ok(authHeader);
  assert.equal(request.origin, 'https://api.beehiiv.com');
  assert.equal(request.pathname, '/v2/publications/pub_123/subscriptions');
  assert.equal(request.searchParams.get('limit'), '25');
  assert.equal(request.searchParams.get('cursor'), 'opaque/cursor?');
  assert.equal(authHeader, `Bearer ${config.apiKey}`);
  assert.deepEqual(result, {
    ok: true,
    subscriptions: [
      {
        id: 'sub_123',
        email: 'member@example.invalid',
        status: 'active',
        created: 1791540000,
      },
    ],
    hasMore: true,
    nextCursor: 'next-page-token',
  });
});

void test('reads every subscription page and only returns the complete list', async () => {
  const requests: URL[] = [];
  const result = await listAll(config, (input) => {
    const address =
      input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const url = new URL(address);
    requests.push(url);
    const cursor = url.searchParams.get('cursor');
    return Promise.resolve(
      cursor === null
        ? Response.json({
            data: [{ id: 'sub_1', email: 'one@example.invalid', status: 'active', created: 100 }],
            has_more: true,
            next_cursor: 'next-page',
          })
        : Response.json({
            data: [
              { id: 'sub_2', email: 'two@example.invalid', status: 'unsubscribed', created: 200 },
            ],
            has_more: false,
            next_cursor: null,
          }),
    );
  });

  assert.deepEqual(
    requests.map((url) => url.searchParams.get('cursor')),
    [null, 'next-page'],
  );
  assert.deepEqual(
    requests.map((url) => url.searchParams.get('limit')),
    ['100', '100'],
  );
  assert.deepEqual(result, {
    ok: true,
    subscriptions: [
      { id: 'sub_1', email: 'one@example.invalid', status: 'active', created: 100 },
      { id: 'sub_2', email: 'two@example.invalid', status: 'unsubscribed', created: 200 },
    ],
    pagesRead: 2,
  });
});

void test('does not return a partial list when a later subscription page fails', async () => {
  let calls = 0;
  const result = await listAll(config, () => {
    calls += 1;
    if (calls === 1)
      return Promise.resolve(
        Response.json({
          data: [{ id: 'sub_1', email: 'one@example.invalid', status: 'active', created: 100 }],
          has_more: true,
          next_cursor: 'next-page',
        }),
      );
    return Promise.resolve(new Response(null, { status: 503 }));
  });

  assert.deepEqual(result, {
    ok: false,
    kind: 'provider_error',
    status: 503,
    retryAfterMs: null,
    pagesRead: 2,
  });
});

void test('rejects a cursor cycle across pages instead of retrying an earlier page', async () => {
  let calls = 0;
  const result = await listAll(config, () => {
    calls += 1;
    const cursor = calls === 1 ? null : calls === 2 ? 'first' : 'second';
    return Promise.resolve(
      Response.json({
        data: [],
        has_more: true,
        next_cursor: cursor === null ? 'first' : cursor === 'first' ? 'second' : 'first',
      }),
    );
  });

  assert.equal(calls, 3);
  assert.deepEqual(result, {
    ok: false,
    kind: 'invalid_response',
    status: 200,
    retryAfterMs: null,
    pagesRead: 3,
  });
});

void test('fails closed when a full roster exceeds its bounded page count', async () => {
  let calls = 0;
  const result = await listAll(config, () => {
    calls += 1;
    return Promise.resolve(
      Response.json({ data: [], has_more: true, next_cursor: `page-${calls}` }),
    );
  });

  assert.equal(calls, 25);
  assert.deepEqual(result, {
    ok: false,
    kind: 'invalid_response',
    status: 200,
    retryAfterMs: null,
    pagesRead: 25,
  });
});

void test('returns bounded Retry-After timing for Beehiiv rate limits', async () => {
  const result = await listPage(config, {}, () =>
    Promise.resolve(new Response(null, { status: 429, headers: { 'Retry-After': '125.25' } })),
  );

  assert.deepEqual(result, {
    ok: false,
    kind: 'provider_error',
    status: 429,
    retryAfterMs: 125_250,
  });
});

void test('parses HTTP-date Retry-After against the supplied polling clock', async () => {
  const result = await listPage(config, { now: () => Date.parse('2026-10-09T10:00:00.000Z') }, () =>
    Promise.resolve(
      new Response(null, {
        status: 429,
        headers: { 'Retry-After': 'Fri, 09 Oct 2026 10:02:00 GMT' },
      }),
    ),
  );

  assert.deepEqual(result, {
    ok: false,
    kind: 'provider_error',
    status: 429,
    retryAfterMs: 120_000,
  });
});

void test('does not advance a poll cursor when the subscription page is malformed', async () => {
  const result = await listPage(config, {}, () =>
    Promise.resolve(
      Response.json({
        data: [{ id: 'not-a-subscription-id', email: 'member@example.invalid' }],
        has_more: true,
        next_cursor: 'skip-ahead',
      }),
    ),
  );

  assert.deepEqual(result, {
    ok: false,
    kind: 'invalid_response',
    status: 200,
    retryAfterMs: null,
  });
});

void test('rejects a repeated next cursor so a poller cannot get stuck on one page', async () => {
  const result = await listPage(config, { cursor: 'same-page-token' }, () =>
    Promise.resolve(Response.json({ data: [], has_more: true, next_cursor: 'same-page-token' })),
  );

  assert.deepEqual(result, {
    ok: false,
    kind: 'invalid_response',
    status: 200,
    retryAfterMs: null,
  });
});

void test('rejects an oversized Beehiiv response before parsing its contents', async () => {
  const result = await listPage(config, {}, () =>
    Promise.resolve(
      Response.json({
        data: [],
        has_more: false,
        next_cursor: null,
        unexpected: 'x'.repeat(1_048_577),
      }),
    ),
  );

  assert.deepEqual(result, {
    ok: false,
    kind: 'invalid_response',
    status: 200,
    retryAfterMs: null,
  });
});

void test('rejects invalid Beehiiv page sizes before making a request', async () => {
  let requested = false;
  const fetcher: typeof fetch = () => {
    requested = true;
    return Promise.resolve(Response.json({ data: [], has_more: false, next_cursor: null }));
  };

  for (const limit of [0, 101, 1.5])
    await assert.rejects(listPage(config, { limit }, fetcher), /Invalid Beehiiv list options/);
  assert.equal(requested, false);
});
