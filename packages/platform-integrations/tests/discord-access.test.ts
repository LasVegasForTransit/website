import assert from 'node:assert/strict';
import test from 'node:test';
const guild = '111111111111111111';
const production = '999999999999999999';
const user = '222222222222222222';
const memberRole = '333333333333333333';
const retiredRole = '444444444444444444';
const unrelatedRole = '555555555555555555';
const configuration = {
  environment: 'preview' as const,
  guildId: guild,
  productionGuildId: production,
  botToken: 'synthetic-bot-token',
};
function address(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function api() {
  const loaded = await import('../src/discord-access').catch(() => null);
  assert.ok(
    loaded,
    'Discord needs an actual bounded REST adapter before server access can be confirmed',
  );
  return loaded;
}
function member(roles: string[], extra: Record<string, unknown> = {}) {
  return {
    user: { id: user, username: 'transit.rider', global_name: 'Transit Rider', avatar: null },
    roles,
    pending: false,
    nick: null,
    ...extra,
  };
}
void test('server reads validate the stable account and only an Unknown Member 404 proves absence', async () => {
  const { DiscordAccess } = await api();
  let response = Response.json(member([memberRole, unrelatedRole]));
  const client = new DiscordAccess(configuration, {
    fetch: (url, init) => {
      assert.equal(address(url), `https://discord.com/api/v10/guilds/${guild}/members/${user}`);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bot synthetic-bot-token');
      assert.equal(init?.redirect, 'manual');
      return Promise.resolve(response);
    },
  });
  const found = await client.readMember(user);
  assert.equal(found?.user.id, user);
  assert.deepEqual(found.roles, [memberRole, unrelatedRole]);
  response = Response.json({ code: 10007 }, { status: 404 });
  assert.equal(await client.readMember(user), null);
  response = Response.json({ code: 10004 }, { status: 404 });
  await assert.rejects(client.readMember(user), { kind: 'unknown' });
  response = Response.json(
    member([], { user: { id: unrelatedRole, username: 'wrong-account', avatar: null } }),
  );
  await assert.rejects(client.readMember(user), { kind: 'invalid_response' });
  response = Response.json({ user: { id: user, username: 'rider' } });
  await assert.rejects(client.readMember(user), { kind: 'invalid_response' });
});
void test('a verified Discord 404 records server absence without retrying an impossible role grant', async () => {
  const { DiscordAccess } = await api();
  let calls = 0;
  const client = new DiscordAccess(configuration, {
    fetch: () => {
      calls++;
      return Promise.resolve(Response.json({ code: 10007 }, { status: 404 }));
    },
  });
  const result = await client.reconcile({
    identityId: user,
    managedRoleIds: [memberRole],
    desiredRoleIds: [memberRole],
    operationId: 'member-absence',
    isCurrent: () => Promise.resolve(true),
  });
  assert.equal(result, null);
  assert.equal(calls, 1, 'a confirmed non-member response must not be retried as a service outage');
});
void test('role reconciliation changes only managed roles and confirms them with a fresh server read', async () => {
  const { DiscordAccess } = await api();
  const calls: string[] = [];
  const roles = new Set([retiredRole, unrelatedRole]);
  const client = new DiscordAccess(configuration, {
    fetch: (url, init) => {
      const path = new URL(address(url)).pathname;
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${path}`);
      if (method === 'GET') return Promise.resolve(Response.json(member([...roles])));
      assert.equal(init?.body, undefined, 'never replace the member’s entire roles array');
      assert.match(new Headers(init?.headers).get('X-Audit-Log-Reason') ?? '', /operation-fixture/);
      const role = path.split('/').at(-1);
      assert.ok(role);
      if (method === 'DELETE') roles.delete(role);
      if (method === 'PUT') roles.add(role);
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  });
  const observed = await client.reconcile({
    identityId: user,
    managedRoleIds: [memberRole, retiredRole],
    desiredRoleIds: [memberRole],
    operationId: 'operation-fixture',
    isCurrent: () => Promise.resolve(true),
  });
  assert.ok(observed?.roles.includes(memberRole));
  assert.ok(observed?.roles.includes(unrelatedRole));
  assert.equal(observed?.roles.includes(retiredRole), false);
  assert.deepEqual(
    calls.map((item) => item.split(' ')[0]),
    ['GET', 'DELETE', 'PUT', 'GET'],
  );
  assert.equal(
    calls.some((item) => item.endsWith(`/roles/${unrelatedRole}`)),
    false,
  );
});
void test('an accepted write without an observed role is a failure, and pending screening blocks grants', async () => {
  const { DiscordAccess } = await api();
  let pending = false;
  let writes = 0;
  const client = new DiscordAccess(configuration, {
    fetch: (_url, init) => {
      if ((init?.method ?? 'GET') === 'GET')
        return Promise.resolve(Response.json(member([], { pending })));
      writes++;
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  });
  const input = {
    identityId: user,
    managedRoleIds: [memberRole],
    desiredRoleIds: [memberRole],
    operationId: 'fixture',
    isCurrent: () => Promise.resolve(true),
  };
  await assert.rejects(client.reconcile(input), { kind: 'provider_unavailable' });
  assert.equal(writes, 1);
  pending = true;
  await assert.rejects(client.reconcile(input), { kind: 'screening_pending' });
  assert.equal(writes, 1);
});
void test('rate limits honor seconds and stop subsequent requests, without leaking provider messages', async () => {
  const { DiscordAccess } = await api();
  let count = 0;
  const client = new DiscordAccess(configuration, {
    fetch: () => {
      count++;
      return Promise.resolve(
        Response.json(
          {
            retry_after: 2.75,
            global: true,
            message: 'synthetic-bot-token must never appear in errors',
          },
          { status: 429, headers: { 'Retry-After': '3.5' } },
        ),
      );
    },
  });
  await assert.rejects(client.readMember(user), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes('synthetic-bot-token'), false);
    assert.equal(Reflect.get(error, 'kind'), 'rate_limited');
    assert.equal(Reflect.get(error, 'retryAfterMs'), 3500);
    assert.equal(Reflect.get(error, 'global'), true);
    return true;
  });
  await assert.rejects(client.readMember(user), { kind: 'rate_limited' });
  assert.equal(count, 1);
  const interruptedBody = new DiscordAccess(configuration, {
    fetch: () =>
      Promise.resolve(
        new Response('rate limit response interrupted', {
          status: 429,
          headers: { 'Retry-After': '125.25', 'X-RateLimit-Global': 'true' },
        }),
      ),
  });
  await assert.rejects(interruptedBody.readMember(user), {
    kind: 'rate_limited',
    retryAfterMs: 125250,
    global: true,
  });
});
void test('a generation change prevents later writes, including after a partial removal', async () => {
  const { DiscordAccess } = await api();
  let current = true;
  const writes: string[] = [];
  const client = new DiscordAccess(configuration, {
    fetch: (_url, init) => {
      if ((init?.method ?? 'GET') === 'GET')
        return Promise.resolve(Response.json(member([retiredRole])));
      assert.ok(init?.method);
      writes.push(init.method);
      current = false;
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  });
  await assert.rejects(
    client.reconcile({
      identityId: user,
      managedRoleIds: [memberRole, retiredRole],
      desiredRoleIds: [memberRole],
      operationId: 'fixture',
      isCurrent: () => Promise.resolve(current),
    }),
    { kind: 'stale_operation' },
  );
  assert.deepEqual(writes, ['DELETE']);
});
void test('preview cannot touch the production guild and invalid IDs or unowned grants make no request', async () => {
  const { DiscordAccess } = await api();
  let count = 0;
  const fetcher: typeof fetch = () => {
    count++;
    return Promise.resolve(Response.json(member([])));
  };
  const unsafe = new DiscordAccess({ ...configuration, guildId: production }, { fetch: fetcher });
  await assert.rejects(unsafe.readMember(user), { kind: 'not_configured' });
  const client = new DiscordAccess(configuration, { fetch: fetcher });
  await assert.rejects(client.readMember('1/roles/2'), { kind: 'not_configured' });
  await assert.rejects(client.readMember('18446744073709551616'), { kind: 'not_configured' });
  await assert.rejects(
    client.reconcile({
      identityId: user,
      managedRoleIds: [memberRole],
      desiredRoleIds: [unrelatedRole],
      operationId: 'fixture',
      isCurrent: () => Promise.resolve(true),
    }),
    { kind: 'not_configured' },
  );
  assert.equal(count, 0);
});
void test('timeouts cover both hanging fetches and hanging response bodies even if abort is ignored', async () => {
  const { DiscordAccess } = await api();
  for (const fetcher of [
    () => new Promise<Response>(() => undefined),
    () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start() {
              /* deliberately never closes */
            },
          }),
        ),
      ),
  ]) {
    const client = new DiscordAccess(configuration, { fetch: fetcher, timeoutMs: 15 });
    const started = performance.now();
    await assert.rejects(client.readMember(user), { kind: 'provider_unavailable' });
    assert.ok(performance.now() - started < 500);
  }
});
void test('a configuration object changed during a request cannot redirect role writes to a different server', async () => {
  const { DiscordAccess } = await api();
  const supplied = { ...configuration };
  const requests: string[] = [];
  const roles = new Set<string>();
  const client = new DiscordAccess(supplied, {
    fetch: (url, init) => {
      requests.push(address(url));
      supplied.guildId = production;
      if (init?.method === 'PUT') roles.add(memberRole);
      return Promise.resolve(
        init?.method === 'GET'
          ? Response.json(member([...roles]))
          : new Response(null, { status: 204 }),
      );
    },
  });
  await client.reconcile({
    identityId: user,
    managedRoleIds: [memberRole],
    desiredRoleIds: [memberRole],
    operationId: 'fixture',
    isCurrent: () => Promise.resolve(true),
  });
  assert.equal(
    requests.every((url) => url.includes(`/guilds/${guild}/`)),
    true,
  );
});
