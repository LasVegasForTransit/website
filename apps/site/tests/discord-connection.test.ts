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
    assert.match(response.headers.get('Set-Cookie') ?? '', /Max-Age=0/);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(everyStoredText(db).includes('fixture-access-token'), false);
    const replay = await loaded.completeDiscordConnection(env, request, options);
    assert.equal(replay.headers.get('Location'), '/account/discord/?result=failed');
  }
});
