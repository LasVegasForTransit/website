import assert from 'node:assert/strict';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { createSession } from '@lasvegasfortransit/platform-storage/auth';
export const origin = 'https://lasvegasfortransit.org';
export const user = {
  id: '222222222222222222',
  username: 'verified.member',
  global_name: 'Verified Member',
  avatar: null,
};
export const bearer = 'fixture-access-token',
  refresh = 'fixture-refresh-token';
export async function fixture(fetcher?: typeof fetch) {
  const loaded = await import('../../src/discord-link').catch(() => null);
  assert.ok(
    loaded,
    'members must be able to verify their own Discord account using the actual OAuth flow',
  );
  const db = memoryDb();
  const joins: Request[] = [];
  const env = {
    PLATFORM_DB: db,
    LVBT_SIGN_IN_SECRET: 'fixture-session-secret',
    LVBT_DISCORD_APPLICATION_ID: '111111111111111111',
    LVBT_DISCORD_CLIENT_SECRET: 'fixture-client-secret',
    LVBT_DEPLOYMENT_ENV: 'production',
    LVBT_DISCORD_JOBS: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        joins.push(new Request(input, init));
        return Promise.resolve(Response.json({ kind: 'connected' }));
      },
    },
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
          scope: 'identify guilds.join',
          expires_in: 600,
        })
      : Response.json(user);
  };
  const client = new loaded.DiscordLink(env, { fetch: provider, timeoutMs: 20 });
  const csrf = await client.formToken(session.token, origin);
  assert.ok(csrf);
  return { ...loaded, db, env, client, session, csrf, calls, joins, person, people };
}
