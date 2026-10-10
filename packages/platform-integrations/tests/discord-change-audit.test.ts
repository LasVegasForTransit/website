import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { queueDiscordDrift } from '@lasvegasfortransit/platform-storage/discord-drift';
import { pendingDiscordOperations } from '@lasvegasfortransit/platform-storage/discord-pending';
import { syncDiscordOperation } from '../src/discord-sync';
import { DiscordAccess } from '../src/discord-access';
const guildId = '111111111111111111',
  memberRoleId = '333333333333333333';
const identityId = '222222222222222222',
  retiredRole = '444444444444444444';
async function fixture() {
  const db = memoryDb(),
    people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'audit@example.invalid' },
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
      "INSERT INTO committee_account_mappings(committee_id,provider,external_id,recorded_at) VALUES('events','discord',?,?)",
    )
    .bind(retiredRole, new Date().toISOString())
    .run();
  await queueDiscordDrift(db, { guildId });
  const [job] = await pendingDiscordOperations(db, new Date(), 25);
  assert.ok(job);
  let now = new Date();
  const roles = new Set<string>();
  let deny = false,
    unknownWrite = false,
    omitEffect = false;
  const client = new DiscordAccess(
    {
      environment: 'preview',
      guildId,
      productionGuildId: '999999999999999999',
      botToken: 'fixture-only',
    },
    {
      timeoutMs: 15,
      fetch: (url, init) => {
        const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        const role = new URL(address).pathname.split('/').at(-1);
        assert.ok(role);
        if (init?.method === 'GET')
          return Promise.resolve(
            Response.json({
              user: {
                id: identityId,
                username: 'fixture.account',
                global_name: null,
                avatar: null,
              },
              roles: [...roles],
              pending: false,
              nick: null,
            }),
          );
        if (deny && init?.method === 'PUT')
          return Promise.resolve(new Response(null, { status: 403 }));
        if (!omitEffect) {
          if (init?.method === 'PUT') roles.add(role);
          if (init?.method === 'DELETE') roles.delete(role);
        }
        return unknownWrite
          ? new Promise<Response>(() => undefined)
          : Promise.resolve(new Response(null, { status: 204 }));
      },
    },
  );
  const sync = (operationId = job) =>
    syncDiscordOperation(db, operationId, { client, memberRoleId, now: () => now });
  const audits = async () =>
    (
      await db
        .prepare(
          "SELECT actor_id,action,target_id,json_extract(details,'$.provider') AS provider,json_extract(details,'$.resourceId') AS resource,json_extract(details,'$.targetId') AS target,json_extract(details,'$.source') AS source FROM staff_audits WHERE action IN ('access.granted','access.revoked') ORDER BY rowid",
        )
        .all()
    ).results;
  return {
    db,
    people,
    person,
    roles,
    job,
    sync,
    audits,
    advance: () => {
      now = new Date(now.getTime() + 61_000);
    },
    deny: () => {
      deny = true;
    },
    unknown: () => {
      unknownWrite = true;
    },
    noEffect: () => {
      omitEffect = true;
    },
  };
}
void test('confirmed grants and removals create attributed history; repeated reads and later drift stay distinct', async () => {
  const f = await fixture();
  assert.equal((await f.sync()).kind, 'confirmed');
  let rows = await f.audits();
  assert.equal(rows.length, 1, 'a confirmed remote grant needs its own access-change audit');
  assert.deepEqual(
    { ...rows[0] },
    {
      actor_id: 'platform:discord',
      action: 'access.granted',
      target_id: f.person.id,
      provider: 'discord',
      resource: memberRoleId,
      target: 'person',
      source: 'discord_drift',
    },
  );
  assert.equal((await f.sync()).kind, 'confirmed');
  assert.equal(
    (await f.audits()).length,
    1,
    'an unchanged observation is not another access change',
  );
  f.roles.delete(memberRoleId);
  assert.equal((await f.sync()).kind, 'confirmed');
  assert.equal(
    (await f.audits()).length,
    2,
    'a later drift repair on the same job is a distinct change',
  );
  await f.people.withdrawConsent(f.person.id, {
    scope: 'newsletter',
    source: 'member',
    withdrawnAt: new Date().toISOString(),
  });
  f.advance();
  const [removal] = await pendingDiscordOperations(f.db, new Date(), 25);
  assert.ok(removal);
  assert.equal((await f.sync(removal)).kind, 'confirmed');
  rows = await f.audits();
  assert.equal(rows.length, 3);
  assert.equal(rows.at(-1)?.action, 'access.revoked');
  f.db.raw.close();
});
void test('a write acknowledgment without role proof creates no access-change audit', async () => {
  const f = await fixture();
  f.noEffect();
  assert.equal((await f.sync()).kind, 'retry');
  assert.deepEqual(await f.audits(), []);
  f.db.raw.close();
});
void test('an interrupted write is confirmed once by a later provider read and survives a new sync invocation', async () => {
  const f = await fixture();
  f.unknown();
  assert.equal((await f.sync()).kind, 'retry');
  assert.deepEqual(await f.audits(), []);
  f.advance();
  assert.equal((await f.sync()).kind, 'confirmed');
  assert.equal((await f.audits()).length, 1, 'retry must recover the recorded pre-write state');
  assert.equal((await f.sync()).kind, 'confirmed');
  assert.equal((await f.audits()).length, 1);
  f.db.raw.close();
});
void test('partial role cleanup is audited on retry even when another requested role remains denied', async () => {
  const f = await fixture();
  f.roles.add(retiredRole);
  f.deny();
  assert.equal((await f.sync()).kind, 'retry');
  assert.deepEqual(await f.audits(), []);
  f.advance();
  assert.equal((await f.sync()).kind, 'retry');
  const rows = await f.audits();
  assert.equal(rows.length, 1, 'the later read proves the retired role was removed');
  assert.equal(rows[0]?.action, 'access.revoked');
  assert.equal(rows[0].resource, retiredRole);
  f.db.raw.close();
});
void test('failed intent persistence prevents remote writes', async () => {
  const f = await fixture();
  f.db.raw.exec(
    "CREATE TRIGGER reject_access_intent BEFORE INSERT ON provider_access_intents BEGIN SELECT RAISE(ABORT,'fixture intent unavailable'); END",
  );
  assert.equal((await f.sync()).kind, 'retry');
  assert.equal(f.roles.size, 0);
  assert.deepEqual(await f.audits(), []);
  f.db.raw.close();
});
void test('failed audit persistence preserves the before-state for one later confirmation', async () => {
  const f = await fixture();
  f.db.raw.exec(
    "CREATE TRIGGER reject_confirmed_access BEFORE INSERT ON staff_audits WHEN NEW.action='access.granted' BEGIN SELECT RAISE(ABORT,'fixture history unavailable'); END",
  );
  assert.equal((await f.sync()).kind, 'retry');
  assert.equal(f.roles.has(memberRoleId), true);
  assert.deepEqual(await f.audits(), []);
  assert.equal(
    (await f.db.prepare('SELECT count(*) AS n FROM provider_access_intents').first())?.n,
    1,
  );
  f.db.raw.exec('DROP TRIGGER reject_confirmed_access');
  f.advance();
  assert.equal((await f.sync()).kind, 'confirmed');
  assert.equal((await f.audits()).length, 1);
  assert.equal(
    (await f.db.prepare('SELECT count(*) AS n FROM provider_access_intents').first())?.n,
    0,
  );
  assert.equal((await f.sync()).kind, 'confirmed');
  assert.equal((await f.audits()).length, 1);
  f.db.raw.close();
});
