import assert from 'node:assert/strict';
import test from 'node:test';
import { pendingDiscordOperations } from '../src/discord-pending';
import { completeProviderOperations } from '../src/provider-completion';
import { runMaintenance } from '../src/retention';
import { PersonService } from '../src/person-service';
import { memoryDb, type MemoryDb } from './support/db';

const stamp = '2026-10-16T12:00:00.000Z';

function retainedProfiles(db: MemoryDb) {
  db.raw
    .prepare(
      `WITH RECURSIVE fixtures(n) AS (
    VALUES(1) UNION ALL SELECT n+1 FROM fixtures WHERE n<5000)
    INSERT INTO people(id,created_at,updated_at,deleted_at,erased_at)
    SELECT 'retained-'||n,?,?,?,? FROM fixtures`,
    )
    .run(stamp, stamp, stamp, stamp);
}

function queryPlans(db: MemoryDb, matches: (sql: string) => boolean): string[][] {
  const plans: string[][] = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (matches(sql)) {
      const values = Array.from({ length: sql.split('?').length - 1 }, () => null);
      plans.push(
        db.raw
          .prepare(`EXPLAIN QUERY PLAN ${sql}`)
          .all(...values)
          .map((row) => String(row.detail)),
      );
    }
    return prepare(sql);
  };
  return plans;
}

void test('idle Discord selection does not scan retained profiles or opaque person keys', async (context) => {
  const db = memoryDb();
  context.after(() => db.raw.close());
  retainedProfiles(db);
  const plans = queryPlans(db, (sql) => sql.startsWith('SELECT id FROM ('));

  assert.deepEqual(await pendingDiscordOperations(db, new Date(stamp), 1), []);
  assert.equal(plans.length, 1);
  assert.deepEqual(
    plans.flat().filter((step) => /^SCAN (?:people|k|p)(?: |$)/.test(step)),
    [],
    'an empty provider queue must not read every retained profile and opaque key',
  );
});

void test('idle profile retention probes indexed erasure and purge queues without revisiting retained profiles', async (context) => {
  const db = memoryDb();
  context.after(() => db.raw.close());
  retainedProfiles(db);
  const plans = queryPlans(
    db,
    (sql) => sql.startsWith('SELECT 1,') && sql.includes('AS newsletter_inbox'),
  );
  const snapshots = queryPlans(db, (sql) => sql.includes('WITH RECURSIVE affected(id) AS ('));

  const result = await runMaintenance(db, { now: new Date(stamp), category: 'profiles' });
  assert.equal(result.profilesErased, 0);
  assert.equal(result.profilesRemoved, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 5000);
  assert.equal(plans.length, 1);
  assert.equal(snapshots.length, 0, 'an idle pass must not read erasure ownership snapshots');
  const [plan] = plans;
  assert.ok(plan);
  assert.ok(
    plan.some((step) => /SEARCH p USING .+\(erased_at=\? AND deleted_at>\?\)/.test(step)),
    'the candidate probe must seek the unerased deletion range in an index',
  );
  assert.ok(
    plan.some((step) => /SEARCH p USING .+\(deleted_at<\?\)/.test(step)),
    'the candidate probe must seek the expired deletion range in an index',
  );
  assert.deepEqual(
    plan.filter((step) => /^SCAN (?:people|p)(?: |$)/.test(step)),
    [],
    'neither candidate queue may scan retained profiles',
  );
});

void test('purged profiles retain due Discord removal and wait for confirmed provider completion', async (context) => {
  const db = memoryDb();
  context.after(() => db.raw.close());
  db.raw
    .prepare('INSERT INTO people(id,created_at,updated_at) VALUES(?,?,?)')
    .run('person', stamp, stamp);
  const people = new PersonService(db);
  await people.linkIdentity('person', {
    platform: 'discord',
    externalId: '222222222222222222',
    linkMethod: 'self_linked',
  });
  db.raw.prepare('UPDATE people SET deleted_at=? WHERE id=?').run(stamp, 'person');
  await people.deletePerson('person');
  const operation = db.raw
    .prepare("SELECT id FROM integration_outbox WHERE person_id='person' AND state='queued'")
    .get();
  assert.ok(operation);
  const operationId = String(operation.id);
  const now = new Date('2030-10-16T12:00:00.000Z');
  await runMaintenance(db, { now, category: 'profiles' });
  assert.equal(db.raw.prepare("SELECT id FROM people WHERE id='person'").get(), undefined);
  assert.deepEqual(await pendingDiscordOperations(db, now, 1), [operationId]);
  assert.equal(await completeProviderOperations(db, { now }), 0);
  db.raw
    .prepare(
      `INSERT INTO provider_operation_receipts
    (operation_id,provider,state,revision_hash,lease_token,observed_at,expires_at)
    VALUES(?,'discord','done','revision','lease',?,?)`,
    )
    .run(operationId, now.toISOString(), '2030-10-16T12:05:00.000Z');
  assert.equal(await completeProviderOperations(db, { now }), 1);
  assert.deepEqual(await pendingDiscordOperations(db, now, 1), []);
});
