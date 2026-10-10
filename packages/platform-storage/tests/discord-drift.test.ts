import assert from 'node:assert/strict';
import test from 'node:test';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { PersonService } from '../src/person-service';
import { enqueueOperation } from '../src/outbox';
import { memoryDb } from './support/db';

async function fixture() {
  const loaded = await import('../src/discord-drift').catch(() => null);
  assert.ok(loaded, 'finished linked accounts need a resumable periodic Discord scan');
  const db = memoryDb(),
    people = new PersonService(db);
  const add = async (id: string, method: 'self_linked' | 'verified_email' = 'self_linked') => {
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: `${id}@example.invalid` },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    await people.linkIdentity(person.id, {
      platform: 'discord',
      externalId: id,
      linkMethod: method,
    });
    return person;
  };
  return { ...loaded, db, people, add };
}
const guildId = '111111111111111111';
void test('a 5000-account scan visits every record once across bounded restartable batches', async () => {
  const { db, queueDiscordDrift } = await fixture();
  const now = new Date('2026-10-04T10:00:00.000Z'),
    stamp = now.toISOString();
  const person = db.raw.prepare('INSERT INTO people(id,created_at,updated_at) VALUES(?,?,?)');
  const consent = db.raw.prepare(
    "INSERT INTO consent_records(id,person_id,scope,given_at,source,method,created_at,updated_at) VALUES(?,?,'newsletter',?,'import','checkbox',?,?)",
  );
  const identity = db.raw.prepare(
    "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES(?,?,'discord',?,?,'self_linked',?,?)",
  );
  db.raw.exec('BEGIN');
  try {
    for (let i = 0; i < 5000; i++) {
      const id = ulid(now.getTime() + i);
      person.run(id, stamp, stamp);
      consent.run(ulid(), id, stamp, stamp, stamp);
      identity.run(ulid(), id, String(222222222222222222n + BigInt(i)), stamp, stamp, stamp);
    }
    db.raw.exec('COMMIT');
  } catch (error) {
    db.raw.exec('ROLLBACK');
    throw error;
  }
  for (let batch = 0; batch < 50; batch++) {
    const result = await queueDiscordDrift(db, { guildId, now: () => now });
    assert.equal(result.scanned, 100);
    assert.equal(result.queued, 100);
    assert.equal(result.complete, batch === 49);
  }
  assert.equal((await queueDiscordDrift(db, { guildId, now: () => now })).kind, 'idle');
  const counts = await db
    .prepare('SELECT count(*) AS jobs,count(DISTINCT person_id) AS people FROM integration_outbox')
    .first();
  assert.ok(counts);
  assert.equal(counts.jobs, 5000);
  assert.equal(counts.people, 5000);
  db.raw.close();
});
void test('membership changed after scan selection keeps only the newer authoritative removal work', async () => {
  const { db, add, people, queueDiscordDrift } = await fixture();
  const person = await add('222222222222222222');
  const now = new Date('2026-10-04T10:00:00.000Z');
  const changed = {
    ...db,
    batch: async (statements: Parameters<typeof db.batch>[0]) => {
      await people.withdrawConsent(person.id, {
        scope: 'newsletter',
        source: 'member',
        withdrawnAt: now.toISOString(),
      });
      return await db.batch(statements);
    },
  };
  const result = await queueDiscordDrift(changed, { guildId, now: () => now });
  assert.equal(result.queued, 0);
  assert.equal((await people.getPerson(person.id))?.membership_status, 'former_member');
  const jobs = (
    await db
      .prepare(
        "SELECT generation,json_extract(payload,'$.source') AS source FROM integration_outbox",
      )
      .all()
  ).results;
  assert.equal(jobs.length, 1);
  const job = jobs[0];
  assert.ok(job);
  assert.equal(job.generation, 1);
  assert.equal(job.source, 'membership_change');
  db.raw.close();
});
void test('expired scan workers cannot overwrite resumed work or release a newer lease', async () => {
  const { db, add, queueDiscordDrift } = await fixture();
  await add('222222222222222222');
  let now = new Date('2026-10-04T10:00:00.000Z');
  const entered = Promise.withResolvers<undefined>(),
    paused = Promise.withResolvers<undefined>();
  const held = {
    ...db,
    batch: async (statements: Parameters<typeof db.batch>[0]) => {
      entered.resolve(undefined);
      await paused.promise;
      return await db.batch(statements);
    },
  };
  const options = { guildId, now: () => now };
  const old = queueDiscordDrift(held, options);
  await entered.promise;
  assert.equal((await queueDiscordDrift(db, options)).kind, 'busy');
  now = new Date('2026-10-04T10:00:31.000Z');
  assert.equal((await queueDiscordDrift(db, options)).queued, 1);
  paused.resolve(undefined);
  assert.equal((await old).kind, 'stale');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM integration_outbox').first())?.n, 1);
  assert.equal(
    (await db.prepare('SELECT last_completed_at FROM provider_scan_checkpoints').first())
      ?.last_completed_at,
    '2026-10-04T10:00:31.000Z',
  );
  db.raw.close();
});
void test('one server scan cannot complete or replace another server checkpoint', async () => {
  const { db, add, queueDiscordDrift } = await fixture();
  await add('222222222222222222');
  await add('333333333333333333');
  const now = () => new Date('2026-10-04T10:00:00.000Z');
  assert.equal((await queueDiscordDrift(db, { guildId, limit: 1, now })).complete, false);
  await queueDiscordDrift(db, { guildId: '999999999999999999', limit: 2, now });
  assert.equal((await queueDiscordDrift(db, { guildId, limit: 1, now })).scanned, 1);
  db.raw.close();
});
void test('bounded scans resume and revisit finished accounts hourly without advancing canonical generations', async () => {
  const { db, add, queueDiscordDrift } = await fixture();
  const first = await add('222222222222222222');
  const second = await add('333333333333333333');
  await add('444444444444444444', 'verified_email');
  let now = new Date('2026-10-04T10:00:00.000Z');
  const options = { guildId, limit: 1, now: () => now };
  assert.deepEqual(await queueDiscordDrift(db, options), {
    kind: 'scanned',
    scanned: 1,
    queued: 1,
    complete: false,
  });
  assert.deepEqual(await queueDiscordDrift(db, options), {
    kind: 'scanned',
    scanned: 1,
    queued: 1,
    complete: true,
  });
  assert.equal((await queueDiscordDrift(db, options)).kind, 'idle');
  const ids = (
    await db.prepare('SELECT person_id FROM integration_outbox').all<{ person_id: string }>()
  ).results;
  assert.deepEqual(new Set(ids.map((row) => row.person_id)), new Set([first.id, second.id]));
  await db.prepare("UPDATE integration_outbox SET state='done'").run();
  now = new Date('2026-10-04T10:59:59.999Z');
  assert.equal((await queueDiscordDrift(db, options)).kind, 'idle');
  now = new Date('2026-10-04T11:00:00.000Z');
  assert.equal((await queueDiscordDrift(db, options)).queued, 1);
  assert.equal((await queueDiscordDrift(db, options)).queued, 1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM integration_outbox').first())?.n, 4);
  assert.equal(
    (await db.prepare('SELECT max(generation) AS n FROM reconcile_generations').first())?.n,
    1,
  );
  db.raw.close();
});
void test('current unfinished work is reused rather than duplicated, including deferred retries', async () => {
  const { db, add, queueDiscordDrift } = await fixture();
  const person = await add('222222222222222222');
  await db.prepare("INSERT INTO reconcile_generations VALUES(?,'person',3)").bind(person.id).run();
  await enqueueOperation(db, {
    id: 'existing',
    kind: 'person_reconcile',
    personId: person.id,
    targetId: 'person',
    generation: 3,
    payload: {},
  });
  await db
    .prepare(
      "UPDATE integration_outbox SET state='retry',next_attempt_at='2026-10-05T12:00:00.000Z' WHERE id='existing'",
    )
    .run();
  const result = await queueDiscordDrift(db, {
    guildId,
    now: () => new Date('2026-10-04T10:00:00.000Z'),
  });
  assert.equal(result.scanned, 1);
  assert.equal(result.queued, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM integration_outbox').first())?.n, 1);
  assert.equal(
    (await db.prepare('SELECT generation FROM reconcile_generations').first())?.generation,
    3,
  );
  db.raw.close();
});
void test('failed queue writes cannot advance the scan or retain partial generations', async () => {
  const { db, add, queueDiscordDrift } = await fixture();
  await add('222222222222222222');
  const options = { guildId, now: () => new Date('2026-10-04T10:00:00.000Z') };
  db.raw.exec(
    "CREATE TRIGGER reject_drift_job BEFORE INSERT ON integration_outbox BEGIN SELECT RAISE(ABORT,'fixture drift failure'); END",
  );
  await assert.rejects(queueDiscordDrift(db, options), /fixture drift failure/);
  assert.equal(
    (await db.prepare('SELECT cursor FROM provider_scan_checkpoints').first())?.cursor,
    null,
  );
  assert.equal((await db.prepare('SELECT count(*) AS n FROM reconcile_generations').first())?.n, 0);
  db.raw.exec('DROP TRIGGER reject_drift_job');
  assert.equal((await queueDiscordDrift(db, options)).queued, 1);
  db.raw.close();
});
