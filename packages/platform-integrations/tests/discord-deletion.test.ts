import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { pendingDiscordOperations } from '@lasvegasfortransit/platform-storage/discord-pending';
import { queueDiscordDrift } from '@lasvegasfortransit/platform-storage/discord-drift';
import { operationIsCurrent } from '@lasvegasfortransit/platform-storage/outbox';
import { syncDiscordOperation } from '../src/discord-sync';
import { DiscordAccess } from '../src/discord-access';
const guildId = '111111111111111111',
  memberRoleId = '333333333333333333';
const identityId = '222222222222222222',
  committeeRoleId = '444444444444444444';
const unrelated = '555555555555555555';
async function fixture() {
  const db = memoryDb(),
    people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'delete@example.invalid', given_name: 'Private Name' },
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
    .prepare("UPDATE committees SET discord_role_id=? WHERE id='events'")
    .bind(committeeRoleId)
    .run();
  const roles = new Set([memberRoleId, committeeRoleId, unrelated]);
  const calls: string[] = [];
  const client = new DiscordAccess(
    {
      environment: 'preview',
      guildId,
      productionGuildId: '999999999999999999',
      botToken: 'fixture-only',
    },
    {
      fetch: (url, init) => {
        const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        calls.push(init?.method ?? 'GET');
        const role = new URL(address).pathname.split('/').at(-1);
        assert.ok(role);
        if (init?.method === 'DELETE') roles.delete(role);
        if (init?.method === 'PUT') roles.add(role);
        return Promise.resolve(
          init?.method === 'GET'
            ? Response.json({
                user: {
                  id: identityId,
                  username: 'private.discord',
                  global_name: 'Private Discord',
                  avatar: null,
                },
                roles: [...roles],
                pending: false,
                nick: 'Private Nick',
              })
            : new Response(null, { status: 204 }),
        );
      },
    },
  );
  return { db, people, person, roles, calls, client };
}
async function deletionJob(db: ReturnType<typeof memoryDb>, personId: string) {
  const row = await db
    .prepare(
      "SELECT id FROM integration_outbox WHERE person_id=? AND json_extract(payload,'$.source')='person_deleted' AND state='queued'",
    )
    .bind(personId)
    .first<{ id: string }>();
  assert.ok(row, 'deleting an account must atomically enqueue access removal');
  return row.id;
}
void test('deletion queues real managed-role removal without restoring erased personal profiles', async () => {
  const { db, people, person, roles, client } = await fixture();
  await queueDiscordDrift(db, { guildId });
  const [original] = await pendingDiscordOperations(db, new Date(), 25);
  assert.ok(original);
  assert.equal(
    (await syncDiscordOperation(db, original, { client, memberRoleId })).kind,
    'confirmed',
  );
  assert.equal((await db.prepare('SELECT count(*) AS n FROM discord_profiles').first())?.n, 1);
  assert.ok(
    Number((await db.prepare('SELECT count(*) AS n FROM access_observations').first())?.n) > 0,
  );
  roles.add(committeeRoleId);
  await people.deletePerson(person.id);
  assert.equal(await operationIsCurrent(db, original), false);
  const job = await deletionJob(db, person.id);
  assert.ok((await pendingDiscordOperations(db, new Date(), 25)).includes(job));
  assert.equal(await operationIsCurrent(db, job), true);
  assert.deepEqual(await syncDiscordOperation(db, job, { client, memberRoleId }), {
    kind: 'confirmed',
  });
  assert.deepEqual([...roles], [unrelated]);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM discord_profiles').first())?.n, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM access_observations').first())?.n, 0);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT state FROM provider_operation_receipts WHERE operation_id=? AND provider='discord'",
        )
        .bind(job)
        .first()
    )?.state,
    'done',
  );
  assert.equal(
    (await db.prepare('SELECT given_name FROM people WHERE id=?').bind(person.id).first())
      ?.given_name,
    null,
  );
  db.raw.close();
});
void test('a failed deletion enqueue rolls back personal erasure and the access generation', async () => {
  const { db, people, person } = await fixture();
  db.raw.exec(
    "CREATE TRIGGER reject_delete_job BEFORE INSERT ON integration_outbox BEGIN SELECT RAISE(ABORT,'fixture queue unavailable'); END",
  );
  await assert.rejects(people.deletePerson(person.id), /fixture queue unavailable/);
  assert.equal((await people.getPerson(person.id))?.given_name, 'Private Name');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM reconcile_generations').first())?.n, 0);
  db.raw.close();
});
void test('repeated deletion retains the original cleanup binding and queues no duplicate work', async () => {
  const { db, people, person } = await fixture();
  await people.deletePerson(person.id);
  const job = await deletionJob(db, person.id);
  const before = await db
    .prepare('SELECT deleted_at FROM people WHERE id=?')
    .bind(person.id)
    .first();
  await people.deletePerson(person.id);
  assert.equal(await deletionJob(db, person.id), job);
  assert.deepEqual(
    await db.prepare('SELECT deleted_at FROM people WHERE id=?').bind(person.id).first(),
    before,
  );
  assert.equal((await db.prepare('SELECT count(*) AS n FROM integration_outbox').first())?.n, 1);
  db.raw.close();
});
void test('cleanup cannot remove a deleted account now linked to a live member', async () => {
  const { db, people, person, roles, client, calls } = await fixture();
  await people.deletePerson(person.id);
  const job = await deletionJob(db, person.id);
  const { person: owner } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'new-owner@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  await db
    .prepare("UPDATE identities SET person_id=? WHERE platform='discord' AND external_id=?")
    .bind(owner.id, identityId)
    .run();
  assert.deepEqual(await syncDiscordOperation(db, job, { client, memberRoleId }), {
    kind: 'not_ready',
  });
  assert.equal(calls.length, 0);
  assert.deepEqual([...roles], [memberRoleId, committeeRoleId, unrelated]);
  db.raw.close();
});
void test('an ownership transfer after the provider read prevents role removal and stale receipt writes', async () => {
  const { db, people, person, roles } = await fixture();
  await people.deletePerson(person.id);
  const job = await deletionJob(db, person.id);
  const { person: owner } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'survivor@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  let writes = 0;
  const client = new DiscordAccess(
    {
      environment: 'preview',
      guildId,
      productionGuildId: '999999999999999999',
      botToken: 'fixture-only',
    },
    {
      fetch: async (_url, init) => {
        if (init?.method !== 'GET') writes++;
        await db
          .prepare("UPDATE identities SET person_id=? WHERE platform='discord' AND external_id=?")
          .bind(owner.id, identityId)
          .run();
        return Response.json({
          user: { id: identityId, username: 'live.owner', global_name: null, avatar: null },
          roles: [...roles],
          pending: false,
          nick: null,
        });
      },
    },
  );
  assert.deepEqual(await syncDiscordOperation(db, job, { client, memberRoleId }), {
    kind: 'stale',
  });
  assert.equal(writes, 0);
  assert.deepEqual([...roles], [memberRoleId, committeeRoleId, unrelated]);
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM provider_operation_receipts').first())?.n,
    0,
  );
  db.raw.close();
});
void test('a cleanup job bound to another deletion cannot be selected or reach Discord', async () => {
  const { db, people, person, client, calls } = await fixture();
  await people.deletePerson(person.id);
  const job = await deletionJob(db, person.id);
  await db
    .prepare(
      "UPDATE integration_outbox SET payload=json_set(payload,'$.deletedAt','2000-01-01T00:00:00.000Z') WHERE id=?",
    )
    .bind(job)
    .run();
  assert.equal(await operationIsCurrent(db, job), false);
  assert.deepEqual(await pendingDiscordOperations(db, new Date(), 25), []);
  assert.deepEqual(await syncDiscordOperation(db, job, { client, memberRoleId }), {
    kind: 'stale',
  });
  assert.equal(calls.length, 0);
  db.raw.close();
});
void test('deletion failures retain a due retry without recreating personal provider data', async () => {
  const { db, people, person } = await fixture();
  await people.deletePerson(person.id);
  const job = await deletionJob(db, person.id);
  const client = new DiscordAccess(
    {
      environment: 'preview',
      guildId,
      productionGuildId: '999999999999999999',
      botToken: 'fixture-only',
    },
    { fetch: () => Promise.resolve(new Response(null, { status: 403 })) },
  );
  const result = await syncDiscordOperation(db, job, { client, memberRoleId });
  assert.equal(result.kind, 'retry');
  assert.equal(
    (await db.prepare('SELECT state FROM integration_outbox WHERE id=?').bind(job).first())?.state,
    'retry',
  );
  assert.equal((await db.prepare('SELECT count(*) AS n FROM discord_profiles').first())?.n, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM access_observations').first())?.n, 0);
  db.raw.close();
});
