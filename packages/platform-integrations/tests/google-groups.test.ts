import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configuration,
  address,
  directory,
  groupId,
  reconciliation,
  userId,
} from './support/google-directory';

async function api() {
  const loaded = await import('../src/google-groups').catch(() => null);
  assert.ok(loaded, 'Google committee access needs a real Directory reconciliation adapter');
  return loaded;
}

void test('committee grants resolve stable identities and read back actual group membership', async () => {
  const { GoogleGroups } = await api();
  const fixture = directory();
  const observed: boolean[] = [];
  const prepared: boolean[] = [];
  const client = new GoogleGroups(configuration, fixture.tokens, { fetch: fixture.fetch });
  const result = await client.reconcile({
    ...reconciliation,
    journal: {
      observe: (state) => {
        observed.push(state.granted);
        return Promise.resolve();
      },
      prepare: (change) => {
        prepared.push(change.wasGranted);
        return Promise.resolve(true);
      },
    },
  });
  assert.equal(result.granted, true);
  assert.equal(result.groupId, groupId);
  assert.equal(result.identityId, userId);
  assert.deepEqual(observed, [false, true]);
  assert.deepEqual(prepared, [false]);
  assert.equal(fixture.calls.filter((call) => call.method === 'POST').length, 1);
  assert.equal(fixture.calls.at(-1)?.path, `/groups/${groupId}/hasMember/${userId}`);
});

void test('preview refuses production groups and unregistered groups before requesting a token', async () => {
  const { GoogleGroups } = await api();
  const fixture = directory();
  for (const config of [
    { ...configuration, managedGroups: [...configuration.productionGroups] },
    configuration,
  ]) {
    const client = new GoogleGroups(config, fixture.tokens, { fetch: fixture.fetch });
    await assert.rejects(
      client.reconcile({ ...reconciliation, groupEmail: 'advocacy@lasvegasfortransit.org' }),
      { kind: 'not_configured' },
    );
  }
  assert.equal(fixture.calls.length, 0);
});

void test('existing owners and managers keep their role while they remain assigned', async () => {
  const { GoogleGroups } = await api();
  for (const role of ['OWNER', 'MANAGER']) {
    const fixture = directory();
    fixture.state.direct = true;
    fixture.state.role = role;
    const result = await new GoogleGroups(configuration, fixture.tokens, {
      fetch: fixture.fetch,
    }).reconcile(reconciliation);
    assert.equal(result.role, role);
    assert.equal(
      fixture.calls.some((call) => call.method !== 'GET'),
      false,
    );
  }
});

void test('withdrawal removes the exact linked account even when it owned the group or its user was deleted', async () => {
  const { GoogleGroups } = await api();
  const fixture = directory();
  fixture.state.direct = true;
  fixture.state.role = 'OWNER';
  const result = await new GoogleGroups(configuration, fixture.tokens, {
    fetch: (input, init) =>
      address(input).includes('/users/')
        ? Promise.resolve(new Response(null, { status: 404 }))
        : fixture.fetch(input, init),
  }).reconcile({ ...reconciliation, identityEmail: null, desired: false });
  assert.equal(result.granted, false);
  assert.deepEqual(
    fixture.calls.filter((call) => call.method === 'DELETE').map((call) => call.path),
    [`/groups/${groupId}/members/${userId}`],
  );
});

void test('nested access cannot be reported as removed and unrelated ancestor groups remain untouched', async () => {
  const { GoogleGroups } = await api();
  const fixture = directory();
  fixture.state.direct = true;
  fixture.state.inherited = true;
  const seen: boolean[] = [];
  await assert.rejects(
    new GoogleGroups(configuration, fixture.tokens, { fetch: fixture.fetch }).reconcile({
      ...reconciliation,
      desired: false,
      journal: {
        observe: (state) => {
          seen.push(state.granted);
          return Promise.resolve();
        },
        prepare: () => Promise.resolve(true),
      },
    }),
    { kind: 'inherited_access' },
  );
  assert.equal(fixture.state.direct, false);
  assert.equal(fixture.state.inherited, true);
  assert.deepEqual(seen, [true, true]);
  assert.equal(fixture.calls.filter((call) => call.method !== 'GET').length, 1);
});

void test('renamed, suspended, archived or cross-tenant accounts cannot receive a grant', async () => {
  const { GoogleGroups } = await api();
  for (const patch of [
    { primaryEmail: 'renamed@lasvegasfortransit.org' },
    { id: 'another-account' },
    { customerId: 'Cother' },
    { suspended: true },
    { archived: true },
  ]) {
    const fixture = directory();
    Object.assign(fixture.state.user, patch);
    await assert.rejects(
      new GoogleGroups(configuration, fixture.tokens, { fetch: fixture.fetch }).reconcile(
        reconciliation,
      ),
    );
    assert.equal(
      fixture.calls.some((call) => call.method !== 'GET'),
      false,
    );
  }
});

void test('group aliases and mismatched membership IDs cannot redirect changes to another account', async () => {
  const { GoogleGroups } = await api();
  for (const mutate of [
    (fixture: ReturnType<typeof directory>) => {
      fixture.state.group.email = 'renamed@lasvegasfortransit.org';
    },
    (fixture: ReturnType<typeof directory>) => {
      fixture.state.direct = true;
      fixture.state.memberId = 'different-user';
    },
  ]) {
    const fixture = directory();
    mutate(fixture);
    await assert.rejects(
      new GoogleGroups(configuration, fixture.tokens, { fetch: fixture.fetch }).reconcile({
        ...reconciliation,
        desired: false,
      }),
      { kind: 'invalid_response' },
    );
    assert.equal(
      fixture.calls.some((call) => call.method !== 'GET'),
      false,
    );
  }
});

void test('a superseded membership change is stopped after journaling and before the provider write', async () => {
  const { GoogleGroups } = await api();
  const fixture = directory();
  let current = true;
  await assert.rejects(
    new GoogleGroups(configuration, fixture.tokens, { fetch: fixture.fetch }).reconcile({
      ...reconciliation,
      isCurrent: () => Promise.resolve(current),
      journal: {
        observe: () => Promise.resolve(),
        prepare: () => {
          current = false;
          return Promise.resolve(true);
        },
      },
    }),
    { kind: 'stale_operation' },
  );
  assert.equal(
    fixture.calls.some((call) => call.method !== 'GET'),
    false,
  );
});

void test('successful writes and duplicate responses require fresh membership readback', async () => {
  const { GoogleGroups } = await api();
  for (const duplicate of [false, true]) {
    const fixture = directory();
    fixture.state.applyWrites = false;
    const client = new GoogleGroups(configuration, fixture.tokens, {
      fetch: (input, init) =>
        init?.method === 'POST' && duplicate
          ? Promise.resolve(Response.json({ error: { code: 409 } }, { status: 409 }))
          : fixture.fetch(input, init),
    });
    await assert.rejects(client.reconcile(reconciliation), { kind: 'provider_unavailable' });
  }
});

void test('Google 403 rate limits honor Retry-After and stop subsequent requests', async () => {
  const { GoogleGroups } = await api();
  const fixture = directory();
  let requests = 0;
  const pauses: number[] = [];
  const client = new GoogleGroups(configuration, fixture.tokens, {
    now: () => Date.parse('2026-10-09T12:00:00Z'),
    fetch: () => {
      requests++;
      return Promise.resolve(
        Response.json(
          { error: { code: 403, errors: [{ reason: 'userRateLimitExceeded' }] } },
          { status: 403, headers: { 'Retry-After': 'Fri, 09 Oct 2026 12:02:00 GMT' } },
        ),
      );
    },
    rateLimit: {
      current: () => Promise.resolve(null),
      defer: (ms) => {
        pauses.push(ms);
        return Promise.resolve();
      },
    },
  });
  await assert.rejects(client.reconcile(reconciliation), {
    kind: 'rate_limited',
    retryAfterMs: 120000,
  });
  await assert.rejects(client.reconcile(reconciliation), {
    kind: 'rate_limited',
    retryAfterMs: 120000,
  });
  assert.deepEqual(pauses, [120000]);
  assert.equal(requests, 1);
});

void test('permission failures, arbitrary 404s and redirects never prove absence', async () => {
  const { GoogleGroups } = await api();
  for (const status of [401, 403, 404, 302]) {
    const fixture = directory();
    await assert.rejects(
      new GoogleGroups(configuration, fixture.tokens, {
        fetch: () => Promise.resolve(Response.json({ error: { code: status } }, { status })),
      }).reconcile({ ...reconciliation, desired: false }),
    );
  }
});

void test('token acquisition and response streams are bounded and failures conceal provider bodies', async () => {
  const { GoogleGroups } = await api();
  const fixture = directory();
  const noToken = new GoogleGroups(
    configuration,
    { getToken: () => new Promise<string>(() => undefined) },
    { timeoutMs: 10, fetch: fixture.fetch },
  );
  await assert.rejects(noToken.reconcile(reconciliation), { kind: 'provider_unavailable' });
  assert.equal(fixture.calls.length, 0);
  for (const fetcher of [
    () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start() {
              /* No data arrives. */
            },
          }),
        ),
      ),
    () => Promise.resolve(new Response('private-provider-detail'.repeat(10000))),
    () => Promise.reject(new Error('secret-token-and-contact')),
  ]) {
    const client = new GoogleGroups(configuration, fixture.tokens, {
      timeoutMs: 10,
      fetch: fetcher,
    });
    await assert.rejects(
      client.reconcile(reconciliation),
      (error: unknown) =>
        error instanceof Error &&
        !/private-provider-detail|secret-token-and-contact/.test(error.message),
    );
  }
});
