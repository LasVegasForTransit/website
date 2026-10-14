import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordAccess, DiscordApiFailure } from '../src/discord-access';

const configuration = {
  environment: 'preview' as const,
  guildId: '111111111111111111',
  productionGuildId: '999999999999999999',
  botToken: 'fixture-bot-only',
};
const user = { id: '222222222222222222', username: 'joined.member', global_name: null };
const accessToken = 'fixture-join-token';
const input = { identityId: user.id, accessToken, isCurrent: () => Promise.resolve(true) };
const path = 'https://discord.com/api/v10/guilds/111111111111111111/members/222222222222222222';

for (const pending of [false, true]) {
  void test(`joining a new member preserves screening=${String(pending)} without sending roles`, async () => {
    const client = new DiscordAccess(configuration, {
      fetch: async (url, init) => {
        const request = new Request(url, init);
        assert.equal(request.url, path);
        assert.equal(request.method, 'PUT');
        assert.equal(request.headers.get('Authorization'), 'Bot fixture-bot-only');
        assert.equal(request.headers.get('Content-Type'), 'application/json');
        assert.equal(request.redirect, 'manual');
        assert.deepEqual(await request.json(), { access_token: 'fixture-join-token' });
        return Response.json({ user, roles: [], pending }, { status: 201 });
      },
    });
    const member = await client.joinMember(input);
    assert.equal(member.user.id, '222222222222222222');
    assert.equal(member.pending, pending);
    assert.deepEqual(member.roles, []);
  });
}

void test('an already present member is read back with every existing role preserved', async () => {
  const methods: string[] = [];
  const client = new DiscordAccess(configuration, {
    fetch: async (url, init) => {
      const request = new Request(url, init);
      assert.equal(request.url, path);
      methods.push(request.method);
      if (request.method === 'PUT') {
        assert.deepEqual(await request.json(), { access_token: 'fixture-join-token' });
        return new Response(null, { status: 204 });
      }
      assert.equal(request.method, 'GET');
      return Response.json({ user, roles: ['444444444444444444'], pending: false });
    },
  });
  const member = await client.joinMember(input);
  assert.deepEqual(methods, ['PUT', 'GET']);
  assert.deepEqual(member.roles, ['444444444444444444']);
});

void test('a stale join is refused before any provider request', async () => {
  let calls = 0;
  const client = new DiscordAccess(configuration, {
    fetch: () => {
      calls += 1;
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  });
  await assert.rejects(
    client.joinMember({ ...input, isCurrent: () => Promise.resolve(false) }),
    (error: unknown) => error instanceof DiscordApiFailure && error.kind === 'stale_operation',
  );
  assert.equal(calls, 0);
});

void test('an invalid user token cannot reach the join API', async () => {
  let calls = 0;
  const client = new DiscordAccess(configuration, {
    fetch: () => {
      calls += 1;
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  });
  for (const token of ['', 'token\r\nAuthorization: stolen', 'a'.repeat(4099)])
    await assert.rejects(client.joinMember({ ...input, accessToken: token }));
  assert.equal(calls, 0);
});

void test('a created response naming a different Discord member is refused', async () => {
  const client = new DiscordAccess(configuration, {
    fetch: () =>
      Promise.resolve(
        Response.json(
          { user: { ...user, id: '333333333333333333' }, roles: [], pending: false },
          { status: 201 },
        ),
      ),
  });
  await assert.rejects(
    client.joinMember(input),
    (error: unknown) => error instanceof DiscordApiFailure && error.kind === 'invalid_response',
  );
});

void test('joining honors Discord rate limits without exposing its user token', async () => {
  const client = new DiscordAccess(configuration, {
    fetch: () =>
      Promise.resolve(
        Response.json({ retry_after: 2, global: true, message: accessToken }, { status: 429 }),
      ),
  });
  await assert.rejects(client.joinMember(input), (error: unknown) => {
    assert.ok(error instanceof DiscordApiFailure);
    assert.equal(error.kind, 'rate_limited');
    assert.equal(error.retryAfterMs, 2000);
    assert.equal(error.global, true);
    assert.equal(error.message.includes(accessToken), false);
    return true;
  });
});

void test('membership changed during the provider request does not confirm a stale join', async () => {
  let current = true;
  const client = new DiscordAccess(configuration, {
    fetch: () => {
      current = false;
      return Promise.resolve(Response.json({ user, roles: [], pending: false }, { status: 201 }));
    },
  });
  await assert.rejects(
    client.joinMember({ ...input, isCurrent: () => Promise.resolve(current) }),
    (error: unknown) => error instanceof DiscordApiFailure && error.kind === 'stale_operation',
  );
});
