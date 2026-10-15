import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '../src/person-service';
import { runMaintenance } from '../src/retention';
import { queryBudget } from '../src/query-budget';
import { eraseProfile } from '../src/person-erasure';
import { memoryDb, type MemoryDb } from './support/db';

const now = new Date('2026-10-14T10:00:00.000Z');
function person(db: MemoryDb, id: string, created = '2020-01-01T00:00:00.000Z') {
  db.raw
    .prepare('INSERT INTO people(id,given_name,email,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(id, 'Private name', `${id}@example.invalid`, created, created);
}
function consent(db: MemoryDb, id: string, scope: string, withdrawn: string | null = null) {
  db.raw
    .prepare(
      `INSERT INTO consent_records(id,person_id,scope,given_at,source,method,wording_version,withdrawn_at,created_at,updated_at)
      VALUES(?,?,?,'2020-01-01','paper','checkbox','v1',?,'2020-01-01','2020-01-01')`,
    )
    .run(`consent-${id}`, id, scope, withdrawn);
}
function engagement(db: MemoryDb, id: string, at: string) {
  db.raw
    .prepare(
      "INSERT INTO engagement_events(id,person_id,type,occurred_at,source,created_at) VALUES(?,?,'attended',?,'check_in',?)",
    )
    .run(`event-${id}`, id, at, at);
}
void test('daily retention erases only old records with no consent, identity or recent engagement', async () => {
  const db = memoryDb();
  try {
    for (const id of [
      'eligible',
      'active-other-scope',
      'withdrawn',
      'withdrawal-only',
      'identity',
      'recent',
      'invalid-history',
      'at-cutoff',
    ])
      person(db, id);
    person(db, 'new', '2026-10-01T00:00:00.000Z');
    consent(db, 'active-other-scope', 'volunteer_contact');
    consent(db, 'withdrawn', 'event_reminders', '2021-01-01');
    db.raw.exec(
      "INSERT INTO consent_withdrawals(id,person_id,origin_person_id,scope,source,withdrawn_at,recorded_at) VALUES('withdrawal','withdrawal-only','withdrawal-only','newsletter','account','2020-01-01','2020-01-01')",
    );
    await new PersonService(db).linkIdentity('identity', {
      platform: 'luma',
      externalId: 'linked-account',
      linkMethod: 'self_linked',
    });
    engagement(db, 'eligible', '2025-04-14T09:59:59.999Z');
    engagement(db, 'at-cutoff', '2025-04-14T10:00:00.000Z');
    engagement(db, 'recent', '2026-10-01');
    engagement(db, 'invalid-history', 'unreadable date');
    const budget = queryBudget(db, 50);
    const result = await runMaintenance(budget.db, { now, category: 'inactive' });
    assert.equal(result.profilesErased, 1);
    assert.equal(
      db.raw.prepare("SELECT given_name FROM people WHERE id='eligible'").get()?.given_name,
      null,
    );
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM people WHERE erased_at IS NULL').get()?.n,
      8,
    );
    assert.ok(budget.queries <= 50);
    assert.deepEqual(db.raw.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.raw.close();
  }
});
void test('a consent saved after selection prevents stale inactivity erasure and leaves the daily claim retryable', async () => {
  const db = memoryDb();
  try {
    person(db, 'choice-race');
    const racing = {
      prepare: (sql: string) => db.prepare(sql),
      batch: async (statements: Parameters<MemoryDb['batch']>[0]) => {
        consent(db, 'choice-race', 'event_reminders');
        return await db.batch(statements);
      },
    };
    await assert.rejects(runMaintenance(racing, { now, category: 'inactive' }), /valid_snapshot=1/);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM member_privacy_runs').get()?.n, 0);
    assert.equal(
      db.raw.prepare("SELECT erased_at FROM people WHERE id='choice-race'").get()?.erased_at,
      null,
    );
    assert.equal((await runMaintenance(db, { now, category: 'inactive' })).profilesErased, 0);
  } finally {
    db.raw.close();
  }
});
void test('the Pacific daily run is repeat-safe, skips other minutes and clamps calendar month ends', async () => {
  const db = memoryDb();
  try {
    person(db, 'first');
    const before = await runMaintenance(db, {
      now: new Date('2026-10-14T09:59:00Z'),
      category: 'inactive',
    });
    assert.equal(before.profilesErased, 0);
    assert.equal((await runMaintenance(db, { now, category: 'inactive' })).profilesErased, 1);
    person(db, 'second');
    assert.equal((await runMaintenance(db, { now, category: 'inactive' })).profilesErased, 0);
    assert.equal(
      (await runMaintenance(db, { now: new Date('2026-10-15T10:00:00Z'), category: 'inactive' }))
        .profilesErased,
      1,
    );
    person(db, 'month-end');
    engagement(db, 'month-end', '2025-02-28T11:30:00Z');
    assert.equal(
      (await runMaintenance(db, { now: new Date('2026-08-31T10:00:00Z'), category: 'inactive' }))
        .profilesErased,
      0,
    );
  } finally {
    db.raw.close();
  }
});
void test('daily retention resumes bounded batches across later ticks and completes an empty day', async () => {
  const db = memoryDb();
  try {
    for (const id of ['batch-one', 'batch-two', 'batch-three']) person(db, id);
    assert.equal(
      (await runMaintenance(db, { now, category: 'inactive', limit: 2 })).profilesErased,
      2,
    );
    assert.equal(
      db.raw.prepare('SELECT completed_at FROM member_privacy_runs').get()?.completed_at,
      null,
    );
    assert.equal(
      (
        await runMaintenance(db, {
          now: new Date('2026-10-14T10:01:00Z'),
          category: 'inactive',
          limit: 2,
        })
      ).profilesErased,
      1,
    );
    assert.ok(db.raw.prepare('SELECT completed_at FROM member_privacy_runs').get()?.completed_at);
    assert.equal(
      (await runMaintenance(db, { now: new Date('2026-10-15T10:00:00Z'), category: 'inactive' }))
        .profilesErased,
      0,
    );
    assert.equal(
      db.raw
        .prepare('SELECT count(*) AS n FROM member_privacy_runs WHERE completed_at IS NOT NULL')
        .get()?.n,
      2,
    );
  } finally {
    db.raw.close();
  }
});
void test('daily run claims roll back with erasure and can retry safely', async () => {
  const db = memoryDb();
  try {
    person(db, 'retry');
    db.raw.exec(
      "CREATE TRIGGER fail_privacy BEFORE UPDATE OF erased_at ON people BEGIN SELECT RAISE(ABORT,'fixture rollback'); END",
    );
    await assert.rejects(runMaintenance(db, { now, category: 'inactive' }), /fixture rollback/);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM member_privacy_runs').get()?.n, 0);
    db.raw.exec('DROP TRIGGER fail_privacy');
    assert.equal((await runMaintenance(db, { now, category: 'inactive' })).profilesErased, 1);
  } finally {
    db.raw.close();
  }
});
void test('deletion retains an opaque requester and completion time after profile purge, without personal data', async () => {
  const db = memoryDb();
  try {
    person(db, 'subject');
    person(db, 'requester');
    await new PersonService(db).deletePerson('subject', { requesterId: 'requester' });
    const record = db.raw.prepare('SELECT * FROM person_deletion_log').get();
    assert.ok(record);
    assert.equal(record.person_id, 'subject');
    assert.equal(record.requested_by, 'requester');
    assert.ok(record.completed_at);
    assert.equal(JSON.stringify(record).includes('Private name'), false);
    assert.equal(JSON.stringify(record).includes('@'), false);
    await new PersonService(db).deletePerson('subject', { requesterId: 'requester' });
    await runMaintenance(db, { now: new Date('2030-01-01T00:00:00Z'), category: 'profiles' });
    assert.equal(db.raw.prepare("SELECT id FROM people WHERE id='subject'").get(), undefined);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM person_deletion_log').get()?.n, 1);
    assert.deepEqual(db.raw.prepare('SELECT * FROM person_deletion_log').get(), record);
  } finally {
    db.raw.close();
  }
});
void test('self-deletion records member without accepting a contact address as a requester', async () => {
  const db = memoryDb();
  try {
    person(db, 'self');
    await assert.rejects(
      new PersonService(db).deletePerson('self', { requesterId: 'contact@example.invalid' }),
      /opaque person key/,
    );
    assert.equal(
      db.raw.prepare("SELECT erased_at FROM people WHERE id='self'").get()?.erased_at,
      null,
    );
    await new PersonService(db).deletePerson('self');
    assert.equal(
      db.raw.prepare("SELECT requested_by FROM person_deletion_log WHERE person_id='self'").get()
        ?.requested_by,
      'member',
    );
    assert.throws(
      () => db.raw.exec("UPDATE person_deletion_log SET requested_by='forged'"),
      /cannot be changed/,
    );
    assert.throws(() => db.raw.exec('DELETE FROM person_deletion_log'), /cannot be removed/);
    assert.throws(
      () =>
        db.raw.exec(
          "INSERT OR REPLACE INTO person_deletion_log(person_id,requested_at,requested_by,reason,operation_id,completed_at) VALUES('self','2026-01-01','member','requested','forged','2026-01-01')",
        ),
      /cannot be replaced/,
    );
  } finally {
    db.raw.close();
  }
});
void test('a deletion receipt preserves the actual request time separately from local completion across replay and purge', async () => {
  const db = memoryDb();
  try {
    person(db, 'delayed-subject');
    person(db, 'staff-requester');
    const requestedAt = '2026-01-15T02:30:00.000Z';
    const operationId = 'delayed-erasure';
    await db.batch([
      db
        .prepare(
          `INSERT INTO person_erasure_scope(operation_id,person_id,requested_at,requested_by,reason)
        VALUES(?,'delayed-subject',?,'staff-requester','requested')`,
        )
        .bind(operationId, requestedAt),
      eraseProfile(db, operationId, requestedAt),
      db.prepare('DELETE FROM person_erasure_scope WHERE operation_id=?').bind(operationId),
    ]);
    const receipt = db.raw
      .prepare("SELECT * FROM person_deletion_log WHERE person_id='delayed-subject'")
      .get();
    assert.ok(receipt);
    assert.equal(receipt.requested_at, requestedAt);
    assert.equal(receipt.requested_by, 'staff-requester');
    assert.ok(
      typeof receipt.completed_at === 'string' &&
        Date.parse(receipt.completed_at) > Date.parse(requestedAt),
    );
    assert.throws(
      () => db.raw.exec("UPDATE person_deletion_log SET requested_at='2026-01-16T00:00:00Z'"),
      /cannot be changed/,
    );
    await new PersonService(db).deletePerson('delayed-subject');
    await runMaintenance(db, { now: new Date('2030-01-01T00:00:00Z'), category: 'profiles' });
    assert.equal(
      db.raw.prepare("SELECT id FROM people WHERE id='delayed-subject'").get(),
      undefined,
    );
    assert.deepEqual(
      db.raw.prepare("SELECT * FROM person_deletion_log WHERE person_id='delayed-subject'").get(),
      receipt,
    );
  } finally {
    db.raw.close();
  }
});
