import assert from 'node:assert/strict';
import test from 'node:test';
import { createSession } from '../src/auth';
import { beginDiscordDisconnect } from '../src/discord-disconnect';
import { queueDiscordDrift } from '../src/discord-drift';
import { pendingDiscordOperations } from '../src/discord-pending';
import { PersonService } from '../src/person-service';
import { completeProviderOperations } from '../src/provider-completion';
import { memoryDb, type MemoryDb } from './support/db';

const guildId = '111111111111111111';
const discordId = '222222222222222222';

function receipt(db: MemoryDb, operationId: string, now: Date, state = 'done') {
  db.raw
    .prepare(
      `INSERT INTO provider_operation_receipts
      (operation_id,provider,state,revision_hash,lease_token,observed_at,expires_at)
      VALUES(?,'discord',?,'revision','lease',?,?) ON CONFLICT(operation_id,provider)
      DO UPDATE SET state=excluded.state,observed_at=excluded.observed_at,expires_at=excluded.expires_at`,
    )
    .run(operationId, state, now.toISOString(), new Date(now.getTime() + 300_000).toISOString());
}

async function fixture(t: test.TestContext) {
  const db = memoryDb();
  t.after(() => db.raw.close());
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'cadence@example.invalid' },
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
  const now = new Date(Date.now() + 1000);
  await queueDiscordDrift(db, { guildId, now: () => now });
  const [operationId] = await pendingDiscordOperations(db, now, 1);
  assert.ok(operationId);
  return { db, people, person, now, operationId };
}

for (const provider of ['beehiiv', 'google_workspace']) {
  void test(`unfinished ${provider} work does not refresh unchanged Discord every five minutes`, async (t) => {
    const { db, person, now } = await fixture(t);
    const stamp = now.toISOString();
    db.raw
      .prepare(
        `INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at)
        VALUES(?,?,?,?,?,'self_linked',?,?)`,
      )
      .run(provider, person.id, provider, `${provider}-fixture`, stamp, stamp, stamp);
    const selectedMinutes: number[] = [];
    for (let minute = 0; minute < 1440; minute++) {
      const tick = new Date(now.getTime() + minute * 60_000);
      await queueDiscordDrift(db, { guildId, now: () => tick });
      const selected = await pendingDiscordOperations(db, tick, 1);
      for (const id of selected) {
        selectedMinutes.push(minute);
        receipt(db, id, tick);
      }
      assert.equal(await completeProviderOperations(db, { now: tick }), 0);
    }
    assert.deepEqual(
      selectedMinutes,
      [
        0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720, 780, 840, 900, 960, 1020,
        1080, 1140, 1200, 1260, 1320, 1380,
      ],
    );
  });
}

void test('expired display freshness does not repeat a confirmed operation before its hourly refresh', async (t) => {
  const { db, now, operationId } = await fixture(t);
  receipt(db, operationId, now);
  assert.deepEqual(await pendingDiscordOperations(db, new Date(now.getTime() + 300_000), 1), []);
  assert.deepEqual(await pendingDiscordOperations(db, new Date(now.getTime() + 3_599_999), 1), []);
  assert.deepEqual(await pendingDiscordOperations(db, new Date(now.getTime() + 3_600_000), 1), [
    operationId,
  ]);
});

for (const change of ['withdrawal', 'deletion']) {
  void test(`${change} queues immediate removal despite a recent earlier confirmation`, async (t) => {
    const { db, people, person, now, operationId } = await fixture(t);
    receipt(db, operationId, now);
    if (change === 'withdrawal')
      await people.withdrawConsent(person.id, {
        scope: 'newsletter',
        source: 'account',
        withdrawnAt: now.toISOString(),
      });
    else await people.deletePerson(person.id);
    const selected = await pendingDiscordOperations(db, new Date(now.getTime() + 60_000), 1);
    assert.equal(selected.length, 1);
    assert.notEqual(selected[0], operationId);
    if (change === 'withdrawal')
      assert.equal((await people.getExactPerson(person.id))?.membership_status, 'former_member');
    else
      assert.ok(
        db.raw.prepare('SELECT erased_at FROM people WHERE id=?').get(person.id)?.erased_at,
      );
  });
}

void test('an interrupted disconnect remains immediately eligible after its confirmation', async (t) => {
  const { db, person, now, operationId } = await fixture(t);
  receipt(db, operationId, now);
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only' };
  const session = await createSession(env, person.id, 'member');
  const identity = db.raw
    .prepare("SELECT id FROM identities WHERE person_id=? AND platform='discord'")
    .get(person.id);
  assert.ok(identity && typeof identity.id === 'string');
  assert.ok(
    await beginDiscordDisconnect(env, {
      sessionToken: session.token,
      origin: 'https://preview.lasvegasfortransit.org',
      identityRecordId: identity.id,
      operationId: 'cadence-disconnect',
      now,
    }),
  );
  receipt(db, 'cadence-disconnect', now);
  assert.deepEqual(await pendingDiscordOperations(db, now, 1), ['cadence-disconnect']);
});

void test('retry and future-dated success receipts cannot suppress due work', async (t) => {
  const { db, now, operationId } = await fixture(t);
  receipt(db, operationId, now, 'retry');
  assert.deepEqual(await pendingDiscordOperations(db, now, 1), [operationId]);
  receipt(db, operationId, new Date(now.getTime() + 60_000));
  assert.deepEqual(await pendingDiscordOperations(db, now, 1), [operationId]);
});

void test('completed shared work still receives periodic drift reconciliation', async (t) => {
  const { db, now, operationId } = await fixture(t);
  receipt(db, operationId, now);
  assert.equal(await completeProviderOperations(db, { now }), 1);
  const later = new Date(now.getTime() + 3_600_000);
  assert.equal((await queueDiscordDrift(db, { guildId, now: () => later })).queued, 1);
  const selected = await pendingDiscordOperations(db, later, 1);
  assert.equal(selected.length, 1);
  assert.notEqual(selected[0], operationId);
});
