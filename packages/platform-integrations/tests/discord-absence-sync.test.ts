import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { enqueueOperation } from '@lasvegasfortransit/platform-storage/outbox';
import { DiscordAccess } from '../src/discord-access';
import { syncDiscordOperation } from '../src/discord-sync';

const guildId = '111111111111111111';
const memberRoleId = '333333333333333333';
const identityId = '222222222222222222';
const configuration = {
  environment: 'preview' as const,
  guildId,
  productionGuildId: '999999999999999999',
  botToken: 'synthetic-token',
};

void test('a Discord 404 saves fresh server absence without retrying the impossible role grant', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'discord-absence@example.invalid', given_name: 'LVBT Name' },
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
    id: 'discord-absence',
    kind: 'person_reconcile',
    personId: person.id,
    targetId: 'person',
    generation: 1,
    payload: {},
  });

  let calls = 0;
  const client = new DiscordAccess(configuration, {
    fetch: () => {
      calls++;
      return Promise.resolve(Response.json({ code: 10007 }, { status: 404 }));
    },
  });
  assert.deepEqual(await syncDiscordOperation(db, 'discord-absence', { client, memberRoleId }), {
    kind: 'confirmed',
  });
  assert.equal(calls, 1);
  const profile = await db
    .prepare('SELECT in_guild,expires_at FROM discord_profiles WHERE guild_id=?')
    .bind(guildId)
    .first<{ in_guild: number; expires_at: string }>();
  assert.ok(profile);
  assert.equal(profile.in_guild, 0);
  assert.ok(Date.parse(profile.expires_at) > Date.now());
  const role = await db
    .prepare("SELECT state FROM access_observations WHERE person_id=? AND target_id='person'")
    .bind(person.id)
    .first<{ state: string }>();
  assert.equal(role?.state, 'absent');
  const receipt = await db
    .prepare(
      "SELECT state FROM provider_operation_receipts WHERE operation_id='discord-absence' AND provider='discord'",
    )
    .first<{ state: string }>();
  assert.equal(receipt?.state, 'done');
  db.raw.close();
});
