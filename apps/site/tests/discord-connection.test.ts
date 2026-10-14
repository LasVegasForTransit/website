import assert from 'node:assert/strict';
import test from 'node:test';
import { unstable_readConfig } from 'wrangler';
import { fileURLToPath } from 'node:url';
import { memoryDb, everyStoredText } from '@lasvegasfortransit/platform-storage/test-db';
import { createSession } from '@lasvegasfortransit/platform-storage/auth';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { DiscordLink } from '@lasvegasfortransit/platform-integrations/discord-link';
interface WorkerConfiguration {
  services: { binding: string; service: string }[];
  d1_databases: { database_id: string }[];
  workers_dev: boolean;
  preview_urls: boolean;
}

void test('website deployments bind joining to the jobs service and database for that environment', () => {
  const file = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));
  for (const [environment, name] of [
    [undefined, 'lvbt-jobs'],
    ['preview', 'lvbt-jobs-preview'],
  ] as const) {
    const website = unstable_readConfig({
      config: file,
      ...(environment ? { env: environment } : {}),
    }) as WorkerConfiguration;
    const jobs = unstable_readConfig({
      config: fileURLToPath(new URL('../../jobs/wrangler.jsonc', import.meta.url)),
      ...(environment ? { env: environment } : {}),
    }) as WorkerConfiguration;
    assert.equal(
      website.services.find((service) => service.binding === 'LVBT_DISCORD_JOBS')?.service,
      name,
    );
    assert.equal(website.d1_databases[0]?.database_id, jobs.d1_databases[0]?.database_id);
    assert.equal(jobs.workers_dev, false);
    assert.equal(jobs.preview_urls, false);
  }
});

void test('the callback sends members to an honest connection result without exposing identity or credentials', async (t) => {
  const loaded = await import('../functions/account/discord/_callback').catch(() => null);
  assert.ok(loaded, 'Discord callback needs distinct server-join outcomes');
  for (const [kind, location] of [
    ['connected', '/account/#discord'],
    ['screening_pending', '/account/discord/?result=screening_pending'],
    ['retry', '/account/discord/?result=retry'],
    ['failed', '/account/discord/?result=failed'],
  ] as const) {
    const db = memoryDb();
    t.after(() => db.raw.close());
    const env = {
      PLATFORM_DB: db,
      LVBT_SIGN_IN_SECRET: 'fixture-session-secret',
      LVBT_DISCORD_APPLICATION_ID: '111111111111111111',
      LVBT_DISCORD_CLIENT_SECRET: 'fixture-client-secret',
      LVBT_DEPLOYMENT_ENV: 'production',
      LVBT_DISCORD_JOBS: { fetch: () => Promise.resolve(Response.json({ kind })) },
    };
    const { person } = await new PersonService(db).upsertFromSource({
      source: 'join_form',
      fields: { email: 'result@example.invalid' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    const session = await createSession(env, person.id, 'member');
    const origin = 'https://lasvegasfortransit.org';
    const client = new DiscordLink(env);
    const csrf = await client.formToken(session.token, origin);
    assert.ok(csrf);
    const started = await client.start({ sessionToken: session.token, origin, csrfToken: csrf });
    assert.ok(started);
    const request = new Request(
      `${origin}/account/discord/callback?state=${started.state}&code=fixture-code`,
      {
        headers: {
          Cookie: `__Host-lvbt_session=${session.token}; __Host-lvbt_discord_state=${started.state}`,
        },
      },
    );
    const options = {
      fetch: (input: RequestInfo | URL) =>
        Promise.resolve(
          new Request(input).url.endsWith('/oauth2/token')
            ? Response.json({
                access_token: 'fixture-access-token',
                refresh_token: 'fixture-refresh-token',
                token_type: 'Bearer',
                scope: 'identify guilds.join',
                expires_in: 600,
              })
            : Response.json({
                id: '222222222222222222',
                username: 'result.member',
                global_name: null,
              }),
        ),
    };
    const response = await loaded.completeDiscordConnection(env, request, options);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('Location'), location);
    if (kind === 'failed')
      assert.doesNotMatch(response.headers.get('Set-Cookie') ?? '', /__Host-lvbt_discord_state=/);
    else assert.match(response.headers.get('Set-Cookie') ?? '', /Max-Age=0/);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(everyStoredText(db).includes('fixture-access-token'), false);
    const replay = await loaded.completeDiscordConnection(env, request, options);
    assert.equal(replay.headers.get('Location'), '/account/discord/?result=failed');
  }
});

async function authorization(t: test.TestContext) {
  const db = memoryDb();
  t.after(() => db.raw.close());
  const env = {
    PLATFORM_DB: db,
    LVBT_SIGN_IN_SECRET: 'fixture-session-secret',
    LVBT_DISCORD_APPLICATION_ID: '111111111111111111',
    LVBT_DISCORD_CLIENT_SECRET: 'fixture-client-secret',
    LVBT_DEPLOYMENT_ENV: 'production',
    LVBT_DISCORD_JOBS: { fetch: () => Promise.reject(new Error('unexpected join')) },
  };
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'cancel@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  const session = await createSession(env, person.id, 'member');
  const origin = 'https://lasvegasfortransit.org';
  const client = new DiscordLink(env);
  const csrf = await client.formToken(session.token, origin);
  assert.ok(csrf);
  const started = await client.start({ sessionToken: session.token, origin, csrfToken: csrf });
  assert.ok(started);
  const cookie = `__Host-lvbt_session=${session.token}; __Host-lvbt_discord_state=${started.state}`;
  return { db, env, person, origin, started, cookie };
}

void test('a valid Discord cancellation returns to the account and its callback cannot be replayed', async (t) => {
  const f = await authorization(t);
  const { completeDiscordConnection } = await import('../functions/account/discord/_callback');
  let calls = 0;
  const options = {
    fetch: () => {
      calls += 1;
      return Promise.reject(new Error('unexpected OAuth'));
    },
  };
  const cancelled = new Request(
    `${f.origin}/account/discord/callback?state=${f.started.state}&error=access_denied&error_description=do-not-display-this`,
    { headers: { Cookie: f.cookie } },
  );
  const response = await completeDiscordConnection(f.env, cancelled, options);
  assert.equal(response.headers.get('Location'), '/account/#discord');
  assert.match(response.headers.get('Set-Cookie') ?? '', /discord_cancelled/);
  assert.doesNotMatch(JSON.stringify([...response.headers]), /do-not-display-this/);
  const replay = await completeDiscordConnection(
    f.env,
    new Request(`${f.origin}/account/discord/callback?state=${f.started.state}&code=fixture-code`, {
      headers: { Cookie: f.cookie },
    }),
    options,
  );
  assert.equal(replay.headers.get('Location'), '/account/discord/?result=failed');
  assert.equal(calls, 0);
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM identities WHERE platform='discord'").first())
      ?.n,
    0,
  );
});

void test('a Discord outage has plain retry guidance without exposing the provider error', async (t) => {
  const f = await authorization(t);
  const { completeDiscordConnection } = await import('../functions/account/discord/_callback');
  const response = await completeDiscordConnection(
    f.env,
    new Request(`${f.origin}/account/discord/callback?state=${f.started.state}&code=fixture-code`, {
      headers: { Cookie: f.cookie },
    }),
    { fetch: () => Promise.resolve(new Response(null, { status: 503 })) },
  );
  assert.equal(response.headers.get('Location'), '/account/discord/?result=unavailable');
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM identities WHERE platform='discord'").first())
      ?.n,
    0,
  );
});

void test('an invalid cancellation cannot clear the current authorization cookie or consume its state', async (t) => {
  const f = await authorization(t);
  const { completeDiscordConnection } = await import('../functions/account/discord/_callback');
  const invalid = await completeDiscordConnection(
    f.env,
    new Request(`${f.origin}/account/discord/callback?state=wrong-state&error=access_denied`, {
      headers: { Cookie: f.cookie },
    }),
  );
  assert.equal(invalid.headers.get('Location'), '/account/discord/?result=failed');
  assert.doesNotMatch(invalid.headers.get('Set-Cookie') ?? '', /__Host-lvbt_discord_state=/);
  const valid = await completeDiscordConnection(
    f.env,
    new Request(
      `${f.origin}/account/discord/callback?state=${f.started.state}&error=access_denied`,
      { headers: { Cookie: f.cookie } },
    ),
  );
  assert.equal(valid.headers.get('Location'), '/account/#discord');
});

void test('a malformed callback leaves the matching unused authorization available', async (t) => {
  const f = await authorization(t);
  const { completeDiscordConnection } = await import('../functions/account/discord/_callback');
  for (const code of ['', `&code=${'x'.repeat(2049)}`]) {
    const invalid = await completeDiscordConnection(
      f.env,
      new Request(`${f.origin}/account/discord/callback?state=${f.started.state}${code}`, {
        headers: { Cookie: f.cookie },
      }),
    );
    assert.equal(invalid.headers.get('Location'), '/account/discord/?result=failed');
    assert.doesNotMatch(invalid.headers.get('Set-Cookie') ?? '', /__Host-lvbt_discord_state=/);
  }
  const valid = await completeDiscordConnection(
    f.env,
    new Request(
      `${f.origin}/account/discord/callback?state=${f.started.state}&error=access_denied`,
      { headers: { Cookie: f.cookie } },
    ),
  );
  assert.equal(valid.headers.get('Location'), '/account/#discord');
});
