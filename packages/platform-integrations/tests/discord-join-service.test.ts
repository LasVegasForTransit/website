import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb, everyStoredText } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';

const user = { id: '222222222222222222', username: 'joining.member', global_name: null };
const env = {
  LVBT_DEPLOYMENT_ENV: 'preview',
  LVBT_DISCORD_SYNC_ENABLED: 'true',
  LVBT_DISCORD_APPLICATION_ID: '555555555555555555',
  LVBT_DISCORD_GUILD_ID: '111111111111111111',
  LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
  LVBT_DISCORD_MEMBER_ROLE_ID: '333333333333333333',
  LVBT_DISCORD_BOT_TOKEN: 'fixture-bot-only',
};
async function fixture() {
  const module = await import('../src/discord-join').catch(() => null);
  assert.ok(
    module,
    'a private joining service must validate the current member and their Discord token',
  );
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'joining@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'discord',
    externalId: user.id,
    linkMethod: 'self_linked',
  });
  const input = {
    personId: person.id,
    discordId: user.id,
    accessToken: 'fixture-access-only',
    operationId: 'fixture-attempt',
    environment: 'preview' as const,
  };
  const calls: string[] = [];
  const provider: typeof fetch = async (url, init) => {
    const request = new Request(url, init);
    calls.push(`${request.method} ${new URL(request.url).pathname}`);
    if (request.url === 'https://discord.com/api/v10/users/@me') {
      assert.equal(request.headers.get('Authorization'), 'Bearer fixture-access-only');
      return Response.json(user);
    }
    assert.equal(
      request.url,
      'https://discord.com/api/v10/guilds/111111111111111111/members/222222222222222222',
    );
    assert.equal(request.method, 'PUT');
    assert.equal(request.headers.get('Authorization'), 'Bot fixture-bot-only');
    assert.deepEqual(await request.json(), { access_token: 'fixture-access-only' });
    return Response.json({ user, roles: [], pending: false }, { status: 201 });
  };
  return { ...module, db, people, person, input, calls, provider };
}

void test('the private join verifies the user token and queues fresh reconciliation without retaining credentials', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  assert.deepEqual(await f.joinDiscordMember(f.db, env, f.input, { fetch: f.provider }), {
    kind: 'connected',
  });
  assert.deepEqual(f.calls, [
    'GET /api/v10/users/@me',
    'PUT /api/v10/guilds/111111111111111111/members/222222222222222222',
  ]);
  assert.equal(
    (
      await f.db
        .prepare("SELECT state FROM integration_outbox WHERE id='discord-join:fixture-attempt'")
        .first()
    )?.state,
    'queued',
  );
  assert.equal(everyStoredText(f.db).includes('fixture-access-only'), false);
  assert.equal(everyStoredText(f.db).includes('fixture-bot-only'), false);
});

void test('a screening-pending join gives a next step while preserving queued reconciliation', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  const provider: typeof fetch = async (url, init) => {
    const response = await f.provider(url, init);
    return new Request(url, init).method === 'PUT'
      ? Response.json({ user, roles: [], pending: true }, { status: 201 })
      : response;
  };
  assert.deepEqual(await f.joinDiscordMember(f.db, env, f.input, { fetch: provider }), {
    kind: 'screening_pending',
  });
  assert.equal(
    (
      await f.db
        .prepare(
          "SELECT count(*) AS n FROM integration_outbox WHERE id='discord-join:fixture-attempt'",
        )
        .first()
    )?.n,
    1,
  );
});

void test('wrong deployment context and a disabled runtime refuse joining before contacting Discord', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  assert.deepEqual(
    await f.joinDiscordMember(
      f.db,
      env,
      { ...f.input, environment: 'production' },
      { fetch: f.provider },
    ),
    { kind: 'failed' },
  );
  assert.deepEqual(
    await f.joinDiscordMember(f.db, { ...env, LVBT_DISCORD_SYNC_ENABLED: 'false' }, f.input, {
      fetch: f.provider,
    }),
    { kind: 'retry' },
  );
  assert.deepEqual(f.calls, []);
});

void test('a different Discord token identity cannot join the linked account', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  let calls = 0;
  const provider: typeof fetch = () => {
    calls += 1;
    return Promise.resolve(Response.json({ ...user, id: '777777777777777777' }));
  };
  assert.deepEqual(await f.joinDiscordMember(f.db, env, f.input, { fetch: provider }), {
    kind: 'failed',
  });
  assert.equal(calls, 1);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM integration_outbox').first())?.n, 0);
});

void test('withdrawal during token verification prevents the external join', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  const provider: typeof fetch = async (url, init) => {
    const response = await f.provider(url, init);
    await f.people.withdrawConsent(f.person.id, {
      scope: 'newsletter',
      source: 'member',
      withdrawnAt: new Date().toISOString(),
    });
    return response;
  };
  assert.deepEqual(await f.joinDiscordMember(f.db, env, f.input, { fetch: provider }), {
    kind: 'failed',
  });
  assert.deepEqual(f.calls, ['GET /api/v10/users/@me']);
});

void test('a persisted Discord pause survives a fresh join operation and permits a later retry', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  let clock = 0,
    limited = true;
  const provider: typeof fetch = async (url, init) => {
    if (new Request(url, init).method === 'PUT' && limited) {
      limited = false;
      f.calls.push('PUT limited');
      return Response.json({ retry_after: 2, global: true }, { status: 429 });
    }
    return await f.provider(url, init);
  };
  const options = { fetch: provider, now: () => clock };
  assert.deepEqual(await f.joinDiscordMember(f.db, env, f.input, options), { kind: 'retry' });
  assert.deepEqual(await f.joinDiscordMember(f.db, env, f.input, options), { kind: 'retry' });
  assert.deepEqual(f.calls, ['GET /api/v10/users/@me', 'PUT limited']);
  clock = 2001;
  assert.deepEqual(await f.joinDiscordMember(f.db, env, f.input, options), { kind: 'connected' });
  assert.equal(everyStoredText(f.db).includes('fixture-access-only'), false);
});

void test('a successful join followed by a failed queue is retryable without a saved token', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  f.db.raw.exec(
    "CREATE TRIGGER fail_join_queue BEFORE INSERT ON integration_outbox BEGIN SELECT RAISE(ABORT,'fixture queue failure'); END",
  );
  assert.deepEqual(await f.joinDiscordMember(f.db, env, f.input, { fetch: f.provider }), {
    kind: 'retry',
  });
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM identities WHERE platform='discord'").first())
      ?.n,
    1,
  );
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM integration_outbox').first())?.n, 0);
  assert.equal(everyStoredText(f.db).includes('fixture-access-only'), false);
  f.db.raw.exec('DROP TRIGGER fail_join_queue');
  assert.deepEqual(await f.joinDiscordMember(f.db, env, f.input, { fetch: f.provider }), {
    kind: 'connected',
  });
});
