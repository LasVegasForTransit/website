import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '../src/person-service';
import { memoryDb } from './support/db';

async function fixture() {
  const loaded = await import('../src/google-drift').catch(() => null);
  assert.ok(loaded, 'verified Workspace links need resumable drift scans');
  const db = memoryDb();
  const people = new PersonService(db);
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
      platform: 'google_workspace',
      externalId: `google-${id}`,
      externalEmail: `${id}@lasvegasfortransit.org`,
      linkMethod: method,
    });
    await db
      .prepare("UPDATE integration_outbox SET state='done' WHERE person_id=?")
      .bind(person.id)
      .run();
    return person;
  };
  return { ...loaded, db, people, add };
}

const customerId = 'C01234567';

void test('a bounded hourly scan revisits verified former members and excludes unverified links', async () => {
  const { db, add, people, queueGoogleDrift } = await fixture();
  const now = new Date('2026-10-09T10:00:00.000Z');
  const former = await add('former');
  await people.withdrawConsent(former.id, {
    scope: 'newsletter',
    source: 'member',
    withdrawnAt: now.toISOString(),
  });
  await db
    .prepare("UPDATE integration_outbox SET state='done' WHERE person_id=?")
    .bind(former.id)
    .run();
  const verified = await add('verified');
  await add('unverified', 'verified_email');

  assert.deepEqual(await queueGoogleDrift(db, { customerId, limit: 1, now: () => now }), {
    kind: 'scanned',
    scanned: 1,
    queued: 1,
    complete: false,
  });
  assert.deepEqual(await queueGoogleDrift(db, { customerId, limit: 1, now: () => now }), {
    kind: 'scanned',
    scanned: 1,
    queued: 1,
    complete: true,
  });
  assert.equal((await queueGoogleDrift(db, { customerId, now: () => now })).kind, 'idle');
  const jobs = (
    await db
      .prepare(
        "SELECT person_id,json_extract(payload,'$.customerId') AS customer_id,json_extract(payload,'$.source') AS source FROM integration_outbox WHERE json_extract(payload,'$.source')='google_drift'",
      )
      .all<{ person_id: string; customer_id: string; source: string }>()
  ).results;
  assert.deepEqual(new Set(jobs.map((job) => job.person_id)), new Set([former.id, verified.id]));
  assert.ok(jobs.every((job) => job.customer_id === customerId));
  const checkpoint = await db
    .prepare('SELECT cursor FROM provider_scan_checkpoints WHERE provider=? AND context_id=?')
    .bind('google_workspace', customerId)
    .first<{ cursor: string | null }>();
  assert.equal(checkpoint?.cursor, null);
  assert.equal(JSON.stringify(checkpoint).includes('lasvegasfortransit.org'), false);
  db.raw.close();
});

void test('a membership change during selection keeps only current reconciliation work', async () => {
  const { db, add, people, queueGoogleDrift } = await fixture();
  const person = await add('changing');
  const now = new Date('2026-10-09T10:00:00.000Z');
  const changing = {
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
  const result = await queueGoogleDrift(changing, { customerId, now: () => now });
  assert.equal(result.queued, 0);
  assert.equal((await people.getPerson(person.id))?.membership_status, 'former_member');
  const jobs = (
    await db
      .prepare(
        "SELECT generation,json_extract(payload,'$.source') AS source FROM integration_outbox WHERE person_id=? AND state IN ('queued','running','retry')",
      )
      .bind(person.id)
      .all<{ generation: number; source: string }>()
  ).results;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.source, 'membership_change');
  db.raw.close();
});

void test('a failed queue write rolls back the generation and scan cursor', async () => {
  const { db, add, queueGoogleDrift } = await fixture();
  await add('rollback');
  const options = { customerId, now: () => new Date('2026-10-09T10:00:00.000Z') };
  const before = await db
    .prepare('SELECT count(*) AS n FROM reconcile_generations')
    .first<{ n: number }>();
  db.raw.exec(
    "CREATE TRIGGER reject_google_drift BEFORE INSERT ON integration_outbox BEGIN SELECT RAISE(ABORT,'fixture queue failure'); END",
  );
  await assert.rejects(queueGoogleDrift(db, options), /fixture queue failure/);
  assert.equal(
    (
      await db
        .prepare('SELECT cursor FROM provider_scan_checkpoints WHERE provider=? AND context_id=?')
        .bind('google_workspace', customerId)
        .first<{ cursor: string | null }>()
    )?.cursor,
    null,
  );
  const generationCount = await db
    .prepare('SELECT count(*) AS n FROM reconcile_generations')
    .first<{ n: number }>();
  assert.ok(before);
  assert.ok(generationCount);
  assert.equal(generationCount.n, before.n);
  db.raw.exec('DROP TRIGGER reject_google_drift');
  assert.equal((await queueGoogleDrift(db, options)).queued, 1);
  db.raw.close();
});

void test('an expired scanner cannot overwrite the successor page or release its lease', async () => {
  const { db, add, queueGoogleDrift } = await fixture();
  await add('takeover');
  let now = new Date('2026-10-09T10:00:00.000Z');
  const entered = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  const held = {
    ...db,
    batch: async (statements: Parameters<typeof db.batch>[0]) => {
      entered.resolve(undefined);
      await resume.promise;
      return await db.batch(statements);
    },
  };
  const options = { customerId, now: () => now };
  const old = queueGoogleDrift(held, options);
  await entered.promise;
  assert.equal((await queueGoogleDrift(db, options)).kind, 'busy');
  now = new Date('2026-10-09T10:00:30.000Z');
  assert.equal((await queueGoogleDrift(db, options)).queued, 1);
  resume.resolve(undefined);
  assert.equal((await old).kind, 'stale');
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS n FROM integration_outbox WHERE json_extract(payload,'$.source')='google_drift'",
        )
        .first()
    )?.n,
    1,
  );
  assert.equal(
    (
      await db
        .prepare(
          'SELECT last_completed_at FROM provider_scan_checkpoints WHERE provider=? AND context_id=?',
        )
        .bind('google_workspace', customerId)
        .first<{ last_completed_at: string }>()
    )?.last_completed_at,
    '2026-10-09T10:00:30.000Z',
  );
  db.raw.close();
});
