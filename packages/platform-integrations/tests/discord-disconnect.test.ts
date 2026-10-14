import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { createSession } from '@lasvegasfortransit/platform-storage/auth';
import { beginDiscordDisconnect } from '@lasvegasfortransit/platform-storage/discord-disconnect';
import { loadDiscordPlan } from '@lasvegasfortransit/platform-storage/discord-plan';
import { pendingDiscordOperations } from '@lasvegasfortransit/platform-storage/discord-pending';
import {
  claimDiscordLease,
  saveDiscordSync,
} from '@lasvegasfortransit/platform-storage/discord-sync-store';
import { completeProviderOperations } from '@lasvegasfortransit/platform-storage/provider-completion';
import { reconcileDiscordPending } from '../src/discord-runner';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';

const memberRoleId = '333333333333333333';
const committeeRoleId = '444444444444444444';
const unmanaged = '666666666666666666';
const discordId = '222222222222222222';
const origin = 'https://preview.lasvegasfortransit.org';
async function fixture(t: test.TestContext) {
  const loaded = await import('../src/discord-disconnect').catch(() => null);
  assert.ok(loaded, 'a confirmed disconnect must revoke access before unlinking');
  const db = memoryDb();
  t.after(() => db.raw.close());
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'disconnect@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'discord',
    externalId: discordId,
    linkMethod: 'self_linked',
  });
  await db
    .prepare('UPDATE committees SET discord_role_id=? WHERE id=?')
    .bind(committeeRoleId, 'events')
    .run();
  const now = { value: Date.now(), step: 0 };
  const time = () => {
    const value = now.value;
    now.value += now.step;
    return value;
  };
  const roles = new Set([memberRoleId, committeeRoleId, unmanaged]);
  const state = { fail: false, failAfterDelete: false, absent: false, pending: false, deletes: 0 };
  const fetcher: typeof fetch = (url, init) => {
    assert.ok(typeof url === 'string');
    if (state.fail || (state.failAfterDelete && state.deletes > 0))
      return Promise.resolve(new Response(null, { status: 503 }));
    if (state.absent) return Promise.resolve(Response.json({ code: 10007 }, { status: 404 }));
    if (init?.method === 'DELETE') {
      const role = url.split('/').at(-1);
      assert.ok(role && role !== unmanaged, 'only managed role endpoints may be deleted');
      roles.delete(role);
      state.deletes += 1;
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    assert.equal(init?.method ?? 'GET', 'GET');
    return Promise.resolve(
      Response.json({
        user: { id: discordId, username: 'member', avatar: null },
        roles: [...roles],
        pending: state.pending,
        nick: null,
      }),
    );
  };
  const env = {
    PLATFORM_DB: db,
    LVBT_SIGN_IN_SECRET: 'fixture-only-secret',
    LVBT_DEPLOYMENT_ENV: 'preview',
    LVBT_DISCORD_SYNC_ENABLED: 'true',
    LVBT_DISCORD_APPLICATION_ID: '555555555555555555',
    LVBT_DISCORD_CLIENT_SECRET: 'fixture-client',
    LVBT_DISCORD_GUILD_ID: '111111111111111111',
    LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
    LVBT_DISCORD_MEMBER_ROLE_ID: memberRoleId,
    LVBT_DISCORD_BOT_TOKEN: 'fixture-bot',
  };
  const jobs = {
    fetch: async (input: RequestInfo | URL) => {
      const request = new Request(input);
      assert.equal(request.url, 'https://jobs.internal/discord/disconnect');
      const result = await loaded.disconnectDiscordMember(db, env, await request.json(), {
        fetch: fetcher,
        now: time,
      });
      return Response.json(result);
    },
  };
  const client = new loaded.DiscordDisconnect({ ...env, LVBT_DISCORD_JOBS: jobs }, { now: time });
  const session = await createSession(env, person.id, 'member');
  const input = { sessionToken: session.token, origin };
  const recover = async () =>
    await reconcileDiscordPending(queryBudget(db, 50).db, {
      configuration: {
        environment: 'preview',
        guildId: env.LVBT_DISCORD_GUILD_ID,
        productionGuildId: env.LVBT_DISCORD_PRODUCTION_GUILD_ID,
        botToken: env.LVBT_DISCORD_BOT_TOKEN,
      },
      applicationId: env.LVBT_DISCORD_APPLICATION_ID,
      memberRoleId,
      fetch: fetcher,
      now: () => new Date(time()),
      limit: 1,
      changeLimit: 1,
    });
  return { ...loaded, db, env, person, state, roles, now, client, input, fetcher, recover };
}

void test('confirmation queues bounded removal and unlinks after all managed access ends', async (t) => {
  const f = await fixture(t);
  f.state.pending = true;
  const token = await f.client.formToken(f.input.sessionToken, origin);
  assert.ok(token);
  assert.deepEqual(await f.client.disconnect({ ...f.input, csrfToken: token }), {
    kind: 'pending',
  });
  assert.equal(f.state.deletes, 1);
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM identities WHERE platform='discord'").first())
      ?.n,
    1,
  );
  const result = await f.recover();
  assert.equal(result.confirmed, 1);
  assert.deepEqual([...f.roles], [unmanaged]);
  assert.equal(f.state.deletes, 2);
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM identities WHERE platform='discord'").first())
      ?.n,
    0,
  );
  assert.equal(
    (
      await f.db
        .prepare('SELECT membership_status FROM people WHERE id=?')
        .bind(f.person.id)
        .first()
    )?.membership_status,
    'member',
  );
  assert.equal(
    (
      await f.db
        .prepare(
          "SELECT count(*) AS n FROM staff_audits WHERE action='identity.discord_disconnect'",
        )
        .first()
    )?.n,
    1,
  );
  const deletes = f.state.deletes;
  await f.client.disconnect({ ...f.input, csrfToken: token });
  assert.equal(
    f.state.deletes,
    deletes,
    'replaying a confirmation cannot repeat provider mutations',
  );
});

void test('provider failure retains cleanup intent and scheduled recovery safely completes unlinking', async (t) => {
  const f = await fixture(t);
  const token = await f.client.formToken(f.input.sessionToken, origin);
  assert.ok(token);
  f.state.fail = true;
  assert.deepEqual(await f.client.disconnect({ ...f.input, csrfToken: token }), { kind: 'retry' });
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM identities WHERE platform='discord'").first())
      ?.n,
    1,
  );
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM discord_disconnects').first())?.n, 1);
  f.state.fail = false;
  f.now.value += 120_000;
  const result = await reconcileDiscordPending(f.db, {
    configuration: {
      environment: 'preview',
      guildId: f.env.LVBT_DISCORD_GUILD_ID,
      productionGuildId: f.env.LVBT_DISCORD_PRODUCTION_GUILD_ID,
      botToken: f.env.LVBT_DISCORD_BOT_TOKEN,
    },
    applicationId: f.env.LVBT_DISCORD_APPLICATION_ID,
    memberRoleId,
    fetch: f.fetcher,
    now: () => new Date(f.now.value),
  });
  assert.equal(result.confirmed, 1);
  assert.deepEqual([...f.roles], [unmanaged]);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM discord_disconnects').first())?.n, 0);
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM identities WHERE platform='discord'").first())
      ?.n,
    0,
  );
});

void test('an account absent from the server disconnects without remote mutations', async (t) => {
  const f = await fixture(t);
  f.state.absent = true;
  const token = await f.client.formToken(f.input.sessionToken, origin);
  assert.ok(token);
  assert.equal((await f.client.disconnect({ ...f.input, csrfToken: token })).kind, 'disconnected');
  assert.equal(f.state.deletes, 0);
});

void test('wrong origin and invalid confirmation cannot request cleanup', async (t) => {
  const f = await fixture(t);
  const token = await f.client.formToken(f.input.sessionToken, origin);
  assert.ok(token);
  assert.equal(
    (
      await f.client.disconnect({
        ...f.input,
        origin: 'https://lasvegasfortransit.org',
        csrfToken: token,
      })
    ).kind,
    'failed',
  );
  assert.equal((await f.client.disconnect({ ...f.input, csrfToken: 'invalid' })).kind, 'failed');
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM discord_disconnects').first())?.n, 0);
  assert.equal(f.state.deletes, 0);
});

void test('a former member can disconnect their own Discord without rejoining LVBT', async (t) => {
  const f = await fixture(t);
  await new PersonService(f.db).withdrawConsent(f.person.id, {
    scope: 'newsletter',
    source: 'member',
    withdrawnAt: new Date().toISOString(),
  });
  const token = await f.client.formToken(f.input.sessionToken, origin);
  assert.ok(token, 'ending membership must not prevent disconnecting a personal account');
  assert.equal((await f.client.disconnect({ ...f.input, csrfToken: token })).kind, 'pending');
  assert.equal((await f.recover()).confirmed, 1);
  assert.notEqual(
    (
      await f.db
        .prepare('SELECT membership_status FROM people WHERE id=?')
        .bind(f.person.id)
        .first()
    )?.membership_status,
    'member',
  );
});

void test('partial cleanup cannot unlink before the remaining access is removed and read back', async (t) => {
  const f = await fixture(t);
  const token = await f.client.formToken(f.input.sessionToken, origin);
  assert.ok(token);
  f.state.failAfterDelete = true;
  assert.equal((await f.client.disconnect({ ...f.input, csrfToken: token })).kind, 'retry');
  assert.deepEqual([...f.roles], [committeeRoleId, unmanaged]);
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM identities WHERE platform='discord'").first())
      ?.n,
    1,
  );
  f.state.failAfterDelete = false;
  f.now.value += 120_000;
  assert.equal((await f.client.disconnect({ ...f.input, csrfToken: token })).kind, 'disconnected');
  assert.deepEqual([...f.roles], [unmanaged]);
});

void test('confirmation is session-bound, expires and cannot be replayed against a replacement account', async (t) => {
  const f = await fixture(t);
  const token = await f.client.formToken(f.input.sessionToken, origin);
  assert.ok(token);
  const otherSession = await createSession(f.env, f.person.id, 'member');
  assert.equal(
    (await f.client.disconnect({ ...f.input, sessionToken: otherSession.token, csrfToken: token }))
      .kind,
    'failed',
  );
  f.now.value += 900_001;
  assert.equal((await f.client.disconnect({ ...f.input, csrfToken: token })).kind, 'failed');
  f.now.value -= 900_001;
  await f.db.prepare("DELETE FROM identities WHERE platform='discord'").run();
  await new PersonService(f.db).linkIdentity(f.person.id, {
    platform: 'discord',
    externalId: '777777777777777777',
    linkMethod: 'self_linked',
  });
  assert.equal((await f.client.disconnect({ ...f.input, csrfToken: token })).kind, 'failed');
  assert.equal(f.state.deletes, 0);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM discord_disconnects').first())?.n, 0);
});

void test('cleanup succeeds when time advances between provider confirmation and final unlink', async (t) => {
  const f = await fixture(t);
  f.now.step = 1;
  const token = await f.client.formToken(f.input.sessionToken, origin);
  assert.ok(token);
  assert.equal((await f.client.disconnect({ ...f.input, csrfToken: token })).kind, 'pending');
  assert.equal((await f.recover()).confirmed, 1);
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM identities WHERE platform='discord'").first())
      ?.n,
    0,
  );
});

for (const deleted of [false, true]) {
  void test(`an interrupted disconnect resumes after saving its success receipt for a ${deleted ? 'deleted' : 'live'} person`, async (t) => {
    const f = await fixture(t);
    const identity = await f.db
      .prepare("SELECT id FROM identities WHERE person_id=? AND platform='discord'")
      .bind(f.person.id)
      .first<{ id: string }>();
    assert.ok(identity);
    assert.ok(
      await beginDiscordDisconnect(f.env, {
        ...f.input,
        identityRecordId: identity.id,
        operationId: 'interrupted-disconnect',
        now: new Date(f.now.value),
      }),
    );
    if (deleted) await new PersonService(f.db).deletePerson(f.person.id);
    const operation = await f.db
      .prepare(
        "SELECT o.id FROM integration_outbox o JOIN reconcile_generations g ON g.person_id=o.person_id AND g.target_id=o.target_id AND g.generation=o.generation WHERE o.person_id=? AND o.target_id='person' AND o.state='queued'",
      )
      .bind(f.person.id)
      .first<{ id: string }>();
    assert.ok(operation);
    const plan = await loadDiscordPlan(f.db, {
      personId: f.person.id,
      guildId: f.env.LVBT_DISCORD_GUILD_ID,
      memberRoleId,
      operationId: operation.id,
    });
    assert.ok(plan);
    const lease = await claimDiscordLease(f.db, plan, new Date(f.now.value));
    assert.ok(lease);
    f.roles.delete(memberRoleId);
    f.roles.delete(committeeRoleId);
    assert.equal(
      await saveDiscordSync(f.db, {
        operationId: operation.id,
        plan,
        lease,
        now: new Date(f.now.value),
        member: {
          user: { id: discordId, username: 'member', displayName: null, avatar: null },
          roles: [unmanaged],
          pending: false,
          nickname: null,
        },
      }),
      true,
    );

    // The worker stopped before unlinking. Its lease expires while the receipt stays fresh.
    f.now.value += 31_000;
    const now = new Date(f.now.value);
    const pending = await pendingDiscordOperations(f.db, now, 100);
    const completed = await completeProviderOperations(f.db, { now });
    assert.deepEqual({ pending, completed }, { pending: [operation.id], completed: 0 });
    const result = await reconcileDiscordPending(f.db, {
      configuration: {
        environment: 'preview',
        guildId: f.env.LVBT_DISCORD_GUILD_ID,
        productionGuildId: f.env.LVBT_DISCORD_PRODUCTION_GUILD_ID,
        botToken: f.env.LVBT_DISCORD_BOT_TOKEN,
      },
      applicationId: f.env.LVBT_DISCORD_APPLICATION_ID,
      memberRoleId,
      fetch: f.fetcher,
      now: () => now,
    });
    assert.equal(result.confirmed, 1);
    assert.equal(
      (await f.db.prepare('SELECT count(*) AS n FROM discord_disconnects').first())?.n,
      0,
    );
    assert.equal(
      (await f.db.prepare("SELECT count(*) AS n FROM identities WHERE platform='discord'").first())
        ?.n,
      0,
    );
    assert.deepEqual([...f.roles], [unmanaged]);
    assert.equal(f.state.deletes, 0, 'recovery reads back access without repeating removals');
    assert.equal(await completeProviderOperations(f.db, { now }), 1);
    assert.equal(
      (
        await f.db
          .prepare('SELECT state FROM integration_outbox WHERE id=?')
          .bind(operation.id)
          .first()
      )?.state,
      'done',
    );
    assert.equal(await completeProviderOperations(f.db, { now }), 0);
  });
}
