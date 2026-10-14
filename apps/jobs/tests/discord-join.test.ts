import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';

async function fixture() {
  const module = await import('../src/discord-join').catch(() => null);
  assert.ok(module, 'the jobs Worker must accept a bounded private Discord join request');
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'private@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'discord',
    externalId: '222222222222222222',
    linkMethod: 'self_linked',
  });
  const env = {
    PLATFORM_DB: db,
    LVBT_DEPLOYMENT_ENV: 'preview',
    LVBT_DISCORD_SYNC_ENABLED: 'true',
    LVBT_DISCORD_APPLICATION_ID: '555555555555555555',
    LVBT_DISCORD_GUILD_ID: '111111111111111111',
    LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
    LVBT_DISCORD_MEMBER_ROLE_ID: '333333333333333333',
    LVBT_DISCORD_BOT_TOKEN: 'fixture-bot-only',
  };
  const input = {
    personId: person.id,
    discordId: '222222222222222222',
    accessToken: 'fixture-access-only',
    operationId: 'private-attempt',
    environment: 'preview',
  };
  let calls = 0;
  const provider: typeof fetch = async (url, init) => {
    calls += 1;
    const request = new Request(url, init);
    const user = { id: '222222222222222222', username: 'private.member', global_name: null };
    if (request.method === 'GET') return Response.json(user);
    assert.deepEqual(await request.json(), { access_token: 'fixture-access-only' });
    return Response.json({ user, roles: [], pending: false }, { status: 201 });
  };
  return { ...module, db, env, input, provider, calls: () => calls };
}

void test('the private jobs endpoint joins only a verified current member', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  const request = new Request('https://jobs.internal/discord/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(f.input),
  });
  const response = await f.handleDiscordJoinRequest(request, f.env, { fetch: f.provider });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { kind: 'connected' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(f.calls(), 2);
});

void test('unrelated paths and methods cannot invoke the private join operation', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  for (const [url, method] of [
    ['https://jobs.internal/', 'POST'],
    ['https://jobs.internal/discord/join', 'GET'],
  ] as const) {
    const response = await f.handleDiscordJoinRequest(new Request(url, { method }), f.env, {
      fetch: f.provider,
    });
    assert.equal(response.status, 404);
  }
  assert.equal(f.calls(), 0);
});

void test('malformed and oversized private requests are refused without provider calls', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  for (const body of [
    '{',
    '[]',
    JSON.stringify({ ...f.input, accessToken: 'x'.repeat(9000) }),
    JSON.stringify({ ...f.input, personId: null }),
  ]) {
    const request = new Request('https://jobs.internal/discord/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const response = await f.handleDiscordJoinRequest(request, f.env, { fetch: f.provider });
    assert.equal(response.status, 400);
    assert.equal((await response.text()).includes('fixture-access-only'), false);
  }
  assert.equal(f.calls(), 0);
});

void test('an incomplete private request times out without accepting its JSON prefix', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(f.input)));
    },
    cancel() {
      cancelled = true;
    },
  });
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    duplex: 'half' as const,
  };
  const request = new Request('https://jobs.internal/discord/join', init);
  const response = await f.handleDiscordJoinRequest(request, f.env, { fetch: f.provider });
  assert.equal(response.status, 400);
  assert.equal(cancelled, true);
  assert.equal(f.calls(), 0);
});
