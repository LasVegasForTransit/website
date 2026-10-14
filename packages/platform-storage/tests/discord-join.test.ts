import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';

const discordId = '222222222222222222';
async function fixture() {
  const module = await import('../src/discord-join').catch(() => null);
  assert.ok(module, 'Discord joining needs a current-member guard and fresh reconciliation');
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'join-member@example.invalid' },
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
  return { ...module, db, people, person, target: { personId: person.id, discordId } };
}

void test('only a current member with exactly one verified Discord link can join', async (t) => {
  const item = await fixture();
  t.after(() => item.db.raw.close());
  assert.equal(await item.discordJoinIsCurrent(item.db, item.target), true);
  assert.equal(
    await item.discordJoinIsCurrent(item.db, { ...item.target, discordId: '333333333333333333' }),
    false,
  );
  await item.people.withdrawConsent(item.person.id, {
    scope: 'newsletter',
    source: 'member',
    withdrawnAt: new Date().toISOString(),
  });
  assert.equal(await item.discordJoinIsCurrent(item.db, item.target), false);
});

void test('ambiguous and unverified identity links cannot authorize joining', async (t) => {
  const item = await fixture();
  t.after(() => item.db.raw.close());
  await item.db
    .prepare("UPDATE identities SET link_method='created_by_platform' WHERE platform='discord'")
    .run();
  assert.equal(await item.discordJoinIsCurrent(item.db, item.target), false);
  await item.db
    .prepare("UPDATE identities SET link_method='self_linked' WHERE platform='discord'")
    .run();
  await item.people.linkIdentity(item.person.id, {
    platform: 'discord',
    externalId: '333333333333333333',
    linkMethod: 'self_linked',
  });
  assert.equal(await item.discordJoinIsCurrent(item.db, item.target), false);
});

void test('joining queues fresh work after an earlier reconciliation already completed', async (t) => {
  const item = await fixture();
  t.after(() => item.db.raw.close());
  const stamp = '2026-10-13T20:00:00.000Z';
  await item.db
    .prepare(
      "INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(?,'person',1) ON CONFLICT DO NOTHING",
    )
    .bind(item.person.id)
    .run();
  await item.db
    .prepare(
      "INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,state,next_attempt_at,created_at,updated_at) VALUES('before-join','person_reconcile',?,'person',1,'{}','done',?,?,?)",
    )
    .bind(item.person.id, stamp, stamp, stamp)
    .run();
  const input = {
    ...item.target,
    operationId: 'fixture-attempt',
    guildId: '111111111111111111',
    now: new Date(stamp),
  };
  assert.equal(await item.queueDiscordJoin(item.db, input), true);
  assert.equal(await item.queueDiscordJoin(item.db, input), true);
  const rows = await item.db
    .prepare('SELECT id,state,generation,payload FROM integration_outbox ORDER BY id')
    .all<{ id: string; state: string; generation: number; payload: string }>();
  assert.deepEqual(
    rows.results.map(({ id, state, generation }) => ({ id, state, generation })),
    [
      { id: 'before-join', state: 'done', generation: 1 },
      { id: 'discord-join:fixture-attempt', state: 'queued', generation: 1 },
    ],
  );
  assert.deepEqual(JSON.parse(rows.results[1]?.payload ?? '{}'), {
    source: 'discord_join',
    guildId: '111111111111111111',
  });
});

void test('a member who withdraws after joining cannot receive queued access work', async (t) => {
  const item = await fixture();
  t.after(() => item.db.raw.close());
  await item.people.withdrawConsent(item.person.id, {
    scope: 'newsletter',
    source: 'member',
    withdrawnAt: new Date().toISOString(),
  });
  assert.equal(
    await item.queueDiscordJoin(item.db, {
      ...item.target,
      operationId: 'withdrawn-attempt',
      guildId: '111111111111111111',
      now: new Date(),
    }),
    false,
  );
  assert.equal(
    (
      await item.db
        .prepare(
          "SELECT count(*) AS n FROM integration_outbox WHERE id='discord-join:withdrawn-attempt'",
        )
        .first()
    )?.n,
    0,
  );
});
