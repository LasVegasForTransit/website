import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { enqueueOperation } from '@lasvegasfortransit/platform-storage/outbox';
import { DiscordAccess } from '../src/discord-access';
import { loadDiscordPlan } from '@lasvegasfortransit/platform-storage/discord-plan';
import {
  claimDiscordLease,
  saveDiscordSync,
  releaseDiscordLease,
} from '@lasvegasfortransit/platform-storage/discord-sync-store';
const guildId = '111111111111111111';
const memberRoleId = '333333333333333333';
const identityId = '222222222222222222';
const configuration = {
  environment: 'preview' as const,
  guildId,
  productionGuildId: '999999999999999999',
  botToken: 'synthetic-token',
};
function member(roles: string[]) {
  return {
    user: { id: identityId, username: 'discord.name', global_name: 'Discord Name', avatar: null },
    roles,
    pending: false,
    nick: 'Server Name',
  };
}
async function fixture() {
  const loaded = await import('../src/discord-sync').catch(() => null);
  assert.ok(
    loaded,
    'the Discord adapter must connect its actual reads to current membership jobs and stored confirmations',
  );
  const db = memoryDb(),
    people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'discord-sync@example.invalid', given_name: 'LVBT Name' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'discord',
    externalId: identityId,
    linkMethod: 'self_linked',
  });
  await db
    .prepare(
      "INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(?,'person',1)",
    )
    .bind(person.id)
    .run();
  await enqueueOperation(db, {
    id: 'sync-fixture',
    kind: 'person_reconcile',
    personId: person.id,
    targetId: 'person',
    generation: 1,
    payload: {},
  });
  return { ...loaded, db, people, person };
}
void test('a real adapter reconciliation records actual member-role proof and external profile without replacing LVBT fields', async () => {
  const { db, person, people, syncDiscordOperation } = await fixture();
  const roles = new Set<string>();
  const client = new DiscordAccess(configuration, {
    fetch: (_url, init) => {
      if (init?.method === 'PUT') {
        roles.add(memberRoleId);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(Response.json(member([...roles])));
    },
  });
  assert.deepEqual(await syncDiscordOperation(db, 'sync-fixture', { client, memberRoleId }), {
    kind: 'confirmed',
  });
  const proof = await db
    .prepare(
      "SELECT state,expected_access FROM access_observations WHERE person_id=? AND target_id='person' ORDER BY rowid DESC LIMIT 1",
    )
    .bind(person.id)
    .first();
  assert.equal(proof?.state, 'granted');
  assert.equal(proof.expected_access, 1);
  const profile = await db
    .prepare('SELECT username,display_name,nickname FROM discord_profiles')
    .first();
  assert.equal(profile?.username, 'discord.name');
  assert.equal(profile.display_name, 'Discord Name');
  assert.equal(profile.nickname, 'Server Name');
  assert.equal((await people.getPerson(person.id))?.given_name, 'LVBT Name');
  assert.equal(
    (await db.prepare("SELECT state FROM integration_outbox WHERE id='sync-fixture'").first())
      ?.state,
    'queued',
    'Discord success alone must not claim Google access is complete',
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT state FROM provider_operation_receipts WHERE operation_id='sync-fixture' AND provider='discord'",
        )
        .first()
    )?.state,
    'done',
  );
});
void test('an expired worker cannot append a stale grant after a newer worker records a failure', async () => {
  const { db, person } = await fixture();
  const plan = await loadDiscordPlan(db, { personId: person.id, guildId, memberRoleId });
  assert.ok(plan);
  const now = new Date();
  const old = await claimDiscordLease(db, plan, now);
  assert.ok(old);
  const later = new Date(now.getTime() + 31_000);
  const next = await claimDiscordLease(db, plan, later);
  assert.ok(next);
  assert.equal(
    await saveDiscordSync(db, {
      operationId: 'sync-fixture',
      plan,
      lease: next,
      now: later,
      failure: 'permission_denied',
    }),
    true,
  );
  assert.equal(
    await saveDiscordSync(db, {
      operationId: 'sync-fixture',
      plan,
      lease: old,
      now: later,
      member: {
        user: { id: identityId, username: 'old.read', displayName: null, avatar: null },
        roles: [memberRoleId],
        pending: false,
        nickname: null,
      },
    }),
    false,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS count FROM access_observations WHERE state='granted'")
        .first()
    )?.count,
    0,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT failure FROM provider_operation_receipts WHERE operation_id='sync-fixture'",
        )
        .first()
    )?.failure,
    'permission_denied',
  );
  await releaseDiscordLease(db, old);
  assert.equal(
    (await db.prepare('SELECT token FROM provider_account_leases').first())?.token,
    next.token,
  );
});
void test('429 retry timing is persisted and an early retry never reaches Discord', async () => {
  const { db, syncDiscordOperation } = await fixture();
  let calls = 0;
  const client = new DiscordAccess(configuration, {
    fetch: () => {
      calls++;
      return Promise.resolve(Response.json({ retry_after: 120.5, global: true }, { status: 429 }));
    },
  });
  const before = Date.now();
  assert.deepEqual(await syncDiscordOperation(db, 'sync-fixture', { client, memberRoleId }), {
    kind: 'retry',
    failure: 'rate_limited',
    retryAfterMs: 120500,
  });
  const job = await db
    .prepare("SELECT next_attempt_at FROM integration_outbox WHERE id='sync-fixture'")
    .first<{ next_attempt_at: string }>();
  assert.ok(job);
  assert.ok(Date.parse(job.next_attempt_at) >= before + 120500);
  assert.deepEqual(await syncDiscordOperation(db, 'sync-fixture', { client, memberRoleId }), {
    kind: 'stale',
  });
  assert.equal(calls, 1);
});
void test('all retired mappings are removed across repeated changes and a cleared committee, preserving other roles', async () => {
  const { db, person, syncDiscordOperation } = await fixture();
  const retired = ['444444444444444444', '555555555555555555'];
  const current = '666666666666666666',
    other = '777777777777777777';
  const stamp = new Date().toISOString();
  for (const role of [...retired, current])
    await db
      .prepare(
        "INSERT INTO committee_account_mappings(committee_id,provider,external_id,recorded_at) VALUES('events','discord',?,?)",
      )
      .bind(role, stamp)
      .run();
  await db.prepare("UPDATE committees SET discord_role_id=? WHERE id='events'").bind(current).run();
  await db
    .prepare(
      "INSERT INTO committee_assignments(id,person_id,committee_id,role,started_at,assigned_by,updated_at) VALUES('assignment',?,'events','member',?,?,?)",
    )
    .bind(person.id, stamp, person.id, stamp)
    .run();
  const roles = new Set([...retired, other]);
  const client = new DiscordAccess(configuration, {
    fetch: (url, init) => {
      const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      const role = new URL(address).pathname.split('/').at(-1);
      assert.ok(role);
      if (init?.method === 'DELETE') roles.delete(role);
      if (init?.method === 'PUT') roles.add(role);
      return Promise.resolve(
        init?.method === 'GET'
          ? Response.json(member([...roles]))
          : new Response(null, { status: 204 }),
      );
    },
  });
  assert.deepEqual(await syncDiscordOperation(db, 'sync-fixture', { client, memberRoleId }), {
    kind: 'confirmed',
  });
  assert.deepEqual([...roles].sort(), [memberRoleId, current, other]);
  await db.prepare("UPDATE committees SET discord_role_id=NULL WHERE id='events'").run();
  await db
    .prepare(
      "INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(?,'events',1)",
    )
    .bind(person.id)
    .run();
  await enqueueOperation(db, {
    id: 'cleared-mapping',
    kind: 'committee_reconcile',
    personId: person.id,
    targetId: 'events',
    generation: 1,
    payload: {},
  });
  assert.deepEqual(await syncDiscordOperation(db, 'cleared-mapping', { client, memberRoleId }), {
    kind: 'confirmed',
  });
  assert.deepEqual([...roles].sort(), [memberRoleId, other]);
  await db
    .prepare("DELETE FROM identities WHERE person_id=? AND platform='discord'")
    .bind(person.id)
    .run();
  assert.equal(
    (await db.prepare('SELECT count(*) AS count FROM discord_profiles').first())?.count,
    0,
  );
});
void test('a delayed grant after withdrawal cannot overwrite the current failure or make an old confirmation current', async () => {
  const { db, person, people, syncDiscordOperation } = await fixture();
  const client = new DiscordAccess(configuration, {
    fetch: async (_url, init) => {
      if (init?.method === 'PUT') {
        await people.withdrawConsent(person.id, {
          scope: 'newsletter',
          source: 'member',
          withdrawnAt: new Date().toISOString(),
        });
        await db
          .prepare(
            "UPDATE reconcile_generations SET generation=2 WHERE person_id=? AND target_id='person'",
          )
          .bind(person.id)
          .run();
        await enqueueOperation(db, {
          id: 'new-removal',
          kind: 'person_reconcile',
          personId: person.id,
          targetId: 'person',
          generation: 2,
          payload: {},
        });
        await db
          .prepare(
            "UPDATE integration_outbox SET state='retry',last_failure='permission_denied' WHERE id='new-removal'",
          )
          .run();
        return new Response(null, { status: 204 });
      }
      return Response.json(member([]));
    },
  });
  assert.deepEqual(await syncDiscordOperation(db, 'sync-fixture', { client, memberRoleId }), {
    kind: 'stale',
  });
  assert.equal(
    (await db.prepare("SELECT last_failure FROM integration_outbox WHERE id='new-removal'").first())
      ?.last_failure,
    'permission_denied',
  );
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS count FROM access_observations WHERE state='granted'")
        .first()
    )?.count,
    0,
  );
  assert.equal(
    (await db.prepare('SELECT count(*) AS count FROM provider_operation_receipts').first())?.count,
    0,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='access.granted'")
        .first()
    )?.n,
    0,
    'a stale remote grant cannot create current access-change history',
  );
});
void test('a timeout persists unknown access and a current retry without changing membership', async () => {
  const { db, person, syncDiscordOperation } = await fixture();
  const client = new DiscordAccess(configuration, {
    timeoutMs: 15,
    fetch: () => new Promise<Response>(() => undefined),
  });
  const result = await syncDiscordOperation(db, 'sync-fixture', { client, memberRoleId });
  assert.equal(result.kind, 'retry');
  const job = await db
    .prepare("SELECT state,last_failure,attempts FROM integration_outbox WHERE id='sync-fixture'")
    .first();
  assert.equal(job?.state, 'retry');
  assert.equal(job.last_failure, 'provider_unavailable');
  assert.equal(job.attempts, 1);
  assert.equal(
    (
      await db
        .prepare(
          'SELECT state FROM access_observations WHERE person_id=? ORDER BY rowid DESC LIMIT 1',
        )
        .bind(person.id)
        .first()
    )?.state,
    'unknown',
  );
  assert.equal(
    (await db.prepare('SELECT membership_status FROM people WHERE id=?').bind(person.id).first())
      ?.membership_status,
    'member',
  );
});
void test('concurrent jobs for the same stable Discord account are serialized by a database lease', async () => {
  const { db, syncDiscordOperation } = await fixture();
  let entered: () => void = () => undefined,
    release: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  const client = new DiscordAccess(configuration, {
    fetch: async () => {
      requests++;
      entered();
      await held;
      return Response.json(member([memberRoleId]));
    },
  });
  const first = syncDiscordOperation(db, 'sync-fixture', { client, memberRoleId });
  await started;
  assert.deepEqual(await syncDiscordOperation(db, 'sync-fixture', { client, memberRoleId }), {
    kind: 'busy',
  });
  assert.equal(requests, 1);
  release();
  assert.deepEqual(await first, { kind: 'confirmed' });
  assert.equal(
    (await db.prepare('SELECT count(*) AS count FROM provider_account_leases').first())?.count,
    0,
  );
});
