import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { enrollWorkspaceAccount } from '@lasvegasfortransit/platform-storage/workspace-enrollment';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';

async function fixture() {
  const module = await import('../src/discord-readiness').catch(() => null);
  assert.ok(module, 'staff screening must refresh its exact Discord server membership');
  const db = memoryDb();
  const enrolled = await enrollWorkspaceAccount(
    db,
    {
      customerId: 'C-fixture',
      userId: 'user-fixture',
      email: 'staff-fixture@lasvegasfortransit.org',
      givenName: 'Fixture',
      familyName: 'Staff',
      orgUnitId: 'ou-human',
      suspended: false,
      archived: false,
      deleted: false,
      observedAt: new Date().toISOString(),
    },
    {
      environment: 'production',
      customerId: 'C-fixture',
      humanOrgUnitIds: ['ou-human'],
      includedUserIds: [],
      excludedUserIds: [],
      previewUserIds: [],
    },
  );
  assert.ok(enrolled.personId);
  const people = new PersonService(db);
  await people.linkIdentity(enrolled.personId, {
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
  function request(body: unknown = { personId: enrolled.personId, environment: 'preview' }) {
    return new Request('https://jobs.internal/discord/readiness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  return { ...module, db, env, request, personId: enrolled.personId };
}
void test('screening refresh observes the exact configured guild without changing roles or membership', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  let pending = true;
  const provider: typeof fetch = (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.method, 'GET');
    assert.equal(
      request.url,
      'https://discord.com/api/v10/guilds/111111111111111111/members/222222222222222222',
    );
    return Promise.resolve(
      Response.json({
        user: {
          id: '222222222222222222',
          username: 'fixture.staff',
          global_name: null,
          avatar: null,
        },
        roles: [],
        pending,
      }),
    );
  };
  for (const expected of [1, 0]) {
    const result = await f.handleDiscordReadinessRequest(f.request(), f.env, { fetch: provider });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { kind: 'observed' });
    assert.equal(
      (await f.db.prepare('SELECT pending FROM discord_profiles').first())?.pending,
      expected,
    );
    pending = false;
  }
  assert.equal(
    (await f.db.prepare('SELECT membership_status FROM people WHERE id=?').bind(f.personId).first())
      ?.membership_status,
    'not_member',
  );
  assert.equal(
    (await f.db.prepare('SELECT count(*) AS n FROM committee_assignments').first())?.n,
    0,
  );
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM consent_records').first())?.n, 0);
});
void test('a provider reply cannot confirm an identity removed while the read is in flight', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  const result = await f.handleDiscordReadinessRequest(f.request(), f.env, {
    fetch: async () => {
      await f.db
        .prepare("DELETE FROM identities WHERE person_id=? AND platform='discord'")
        .bind(f.personId)
        .run();
      return Response.json({
        user: { id: '222222222222222222', username: 'fixture.staff', global_name: null },
        roles: [],
        pending: false,
      });
    },
  });
  assert.deepEqual(await result.json(), { kind: 'failed' });
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM discord_profiles').first())?.n, 0);
});
void test('private screening refresh rejects other environments, paths and malformed input without provider calls', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  const provider: typeof fetch = () => {
    throw new Error('Unexpected provider call');
  };
  for (const request of [
    f.request({ personId: f.personId, environment: 'production' }),
    f.request({ personId: null, environment: 'preview' }),
    new Request('https://jobs.internal/discord/readiness'),
    new Request('https://example.invalid/discord/readiness', { method: 'POST' }),
  ]) {
    const result = await f.handleDiscordReadinessRequest(request, f.env, { fetch: provider });
    assert.ok(result.status >= 400);
  }
});

void test('Workspace suspension during provider read withholds the confirmation', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  const result = await f.handleDiscordReadinessRequest(f.request(), f.env, {
    fetch: async () => {
      await f.db.prepare("UPDATE workspace_directory_accounts SET state='inactive'").run();
      return Response.json({
        user: { id: '222222222222222222', username: 'fixture.staff', global_name: null },
        roles: [],
        pending: false,
      });
    },
  });
  assert.deepEqual(await result.json(), { kind: 'failed' });
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM discord_profiles').first())?.n, 0);
});

void test('a failed read preserves the previous observation and a departure records absence', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  const member = {
    user: { id: '222222222222222222', username: 'fixture.staff', global_name: null },
    roles: [],
    pending: false,
  };
  const observed = await f.handleDiscordReadinessRequest(f.request(), f.env, {
    fetch: () => Promise.resolve(Response.json(member)),
  });
  assert.deepEqual(await observed.json(), { kind: 'observed' });
  const failed = await f.handleDiscordReadinessRequest(f.request(), f.env, {
    fetch: () => Promise.resolve(new Response(null, { status: 503 })),
  });
  assert.deepEqual(await failed.json(), { kind: 'retry' });
  assert.equal((await f.db.prepare('SELECT in_guild FROM discord_profiles').first())?.in_guild, 1);
  const departed = await f.handleDiscordReadinessRequest(f.request(), f.env, {
    fetch: () => Promise.resolve(Response.json({ code: 10007 }, { status: 404 })),
  });
  assert.deepEqual(await departed.json(), { kind: 'observed' });
  assert.equal((await f.db.prepare('SELECT in_guild FROM discord_profiles').first())?.in_guild, 0);
});
