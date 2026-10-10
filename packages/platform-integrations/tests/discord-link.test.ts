import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb, everyStoredText } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { createSession } from '@lasvegasfortransit/platform-storage/auth';
const origin = 'https://lasvegasfortransit.org';
const user = {
  id: '222222222222222222',
  username: 'verified.member',
  global_name: 'Verified Member',
  avatar: null,
};
const bearer = 'fixture-access-token',
  refresh = 'fixture-refresh-token';
async function fixture(fetcher?: typeof fetch) {
  const loaded = await import('../src/discord-link').catch(() => null);
  assert.ok(
    loaded,
    'members must be able to verify their own Discord account using the actual OAuth flow',
  );
  const db = memoryDb();
  const env = {
    PLATFORM_DB: db,
    LVBT_SIGN_IN_SECRET: 'fixture-session-secret',
    LVBT_DISCORD_APPLICATION_ID: '111111111111111111',
    LVBT_DISCORD_CLIENT_SECRET: 'fixture-client-secret',
  };
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'member@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  const session = await createSession(env, person.id, 'member');
  const calls: Request[] = [];
  const provider: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push(request);
    if (fetcher) return await fetcher(request);
    return request.url.endsWith('/oauth2/token')
      ? Response.json({
          access_token: bearer,
          refresh_token: refresh,
          token_type: 'Bearer',
          scope: 'identify',
          expires_in: 600,
        })
      : Response.json(user);
  };
  const client = new loaded.DiscordLink(env, { fetch: provider, timeoutMs: 20 });
  const csrf = await client.formToken(session.token, origin);
  assert.ok(csrf);
  return { ...loaded, db, env, client, session, csrf, calls, person, people };
}
void test('OAuth requests identify only and verifies the returned account ID without storing tokens', async () => {
  const { client, session, csrf, db, calls, env } = await fixture();
  const started = await client.start({ sessionToken: session.token, origin, csrfToken: csrf });
  assert.ok(started);
  const authorization = new URL(started.url);
  assert.equal(
    authorization.origin + authorization.pathname,
    'https://discord.com/oauth2/authorize',
  );
  assert.equal(authorization.searchParams.get('scope'), 'identify');
  assert.equal(
    authorization.searchParams.get('redirect_uri'),
    `${origin}/account/discord/callback`,
  );
  const callback = {
    sessionToken: session.token,
    origin,
    state: started.state,
    code: 'fixture-code',
  };
  assert.equal(await client.callback(callback), true);
  assert.equal(await client.callback(callback), false);
  assert.equal(calls.length, 2);
  const exchange = calls[0],
    current = calls[1];
  assert.ok(exchange && current);
  assert.equal(exchange.url, 'https://discord.com/api/v10/oauth2/token');
  assert.equal(exchange.redirect, 'manual');
  assert.equal(
    exchange.headers.get('Authorization'),
    `Basic ${btoa(`${env.LVBT_DISCORD_APPLICATION_ID}:${env.LVBT_DISCORD_CLIENT_SECRET}`)}`,
  );
  assert.equal((await exchange.text()).includes('grant_type=authorization_code'), true);
  assert.equal(current.url, 'https://discord.com/api/v10/users/@me');
  assert.equal(current.headers.get('Authorization'), `Bearer ${bearer}`);
  assert.equal(
    (await db.prepare("SELECT external_id FROM identities WHERE platform='discord'").first())
      ?.external_id,
    user.id,
  );
  const stored = everyStoredText(db);
  for (const token of [
    bearer,
    refresh,
    env.LVBT_DISCORD_CLIENT_SECRET,
    session.token,
    'fixture-code',
  ])
    assert.equal(stored.includes(token), false);
});
void test('start refuses another session, origin, expired form and missing client configuration', async () => {
  const { client, csrf, session, person, env, calls, DiscordLink } = await fixture();
  const other = await createSession(env, person.id, 'member');
  assert.equal(await client.start({ sessionToken: other.token, origin, csrfToken: csrf }), null);
  assert.equal(
    await client.start({
      sessionToken: session.token,
      origin: 'https://attacker.example',
      csrfToken: csrf,
    }),
    null,
  );
  assert.equal(
    await client.start({
      sessionToken: session.token,
      origin: 'https://preview.lasvegasfortransit.org',
      csrfToken: csrf,
    }),
    null,
  );
  assert.equal(
    await new DiscordLink({ ...env, LVBT_DISCORD_CLIENT_SECRET: '' }).start({
      sessionToken: session.token,
      origin,
      csrfToken: csrf,
    }),
    null,
  );
  let clock = Date.now();
  const expiring = new DiscordLink(env, { now: () => clock });
  const form = await expiring.formToken(session.token, origin);
  assert.ok(form);
  clock += 900_000;
  assert.equal(
    await expiring.start({ sessionToken: session.token, origin, csrfToken: form }),
    null,
  );
  assert.equal(calls.length, 0);
});
void test('invalid token responses and bot accounts never create links', async () => {
  for (const response of [
    { access_token: bearer, token_type: 'Bearer', scope: 'email', expires_in: 600 },
    { access_token: bearer, token_type: 'Basic', scope: 'identify', expires_in: 600 },
    { access_token: bearer, token_type: 'Bearer', scope: 'identify', expires_in: -1 },
    { ...user, bot: true },
  ]) {
    const { client, session, csrf, db } = await fixture((request) => {
      if (
        new URL((request as Request).url).pathname.endsWith('/oauth2/token') &&
        Object.hasOwn(response, 'id')
      )
        return Promise.resolve(
          Response.json({
            access_token: bearer,
            token_type: 'Bearer',
            scope: 'identify',
            expires_in: 600,
          }),
        );
      return Promise.resolve(Response.json(response));
    });
    const started = await client.start({ sessionToken: session.token, origin, csrfToken: csrf });
    assert.ok(started);
    await assert.rejects(
      client.callback({ sessionToken: session.token, origin, state: started.state, code: 'code' }),
    );
    assert.equal(
      (
        await db
          .prepare("SELECT count(*) AS count FROM identities WHERE platform='discord'")
          .first()
      )?.count,
      0,
    );
  }
});
void test('withdrawal during account verification cannot authorize a role grant', async () => {
  const item = await fixture(async (request) => {
    if ((request as Request).url.endsWith('/oauth2/token'))
      return Response.json({
        access_token: bearer,
        token_type: 'Bearer',
        scope: 'identify',
        expires_in: 600,
      });
    await item.people.withdrawConsent(item.person.id, {
      scope: 'newsletter',
      source: 'member',
      withdrawnAt: new Date().toISOString(),
    });
    return Response.json(user);
  });
  const started = await item.client.start({
    sessionToken: item.session.token,
    origin,
    csrfToken: item.csrf,
  });
  assert.ok(started);
  assert.equal(
    await item.client.callback({
      sessionToken: item.session.token,
      origin,
      state: started.state,
      code: 'code',
    }),
    false,
  );
  assert.equal(
    (await item.db.prepare('SELECT count(*) AS count FROM integration_outbox').first())?.count,
    0,
  );
});
