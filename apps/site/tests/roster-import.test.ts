import assert from 'node:assert/strict';
import test from 'node:test';
import type { MemoryDb } from '@lasvegasfortransit/platform-storage/test-db';

async function preview(records: unknown[], now = new Date('2026-10-09T12:00:00.000Z')) {
  const loaded = await import('../platform/roster-import').catch(() => null);
  assert.ok(loaded, 'historical roster imports need a consent-provenance preview');
  return loaded.previewRosterImport(records, { now });
}

async function apply(db: MemoryDb, records: unknown[], runId = 'roster-run-1') {
  const loaded = await import('../platform/roster-import').catch(() => null);
  assert.ok(loaded, 'historical roster imports need a repeat-safe apply path');
  return loaded.applyRosterImport(db, records, {
    runId,
    now: new Date('2026-10-09T12:00:00.000Z'),
  });
}

function row(input: {
  source?: string;
  sourceId?: string;
  email?: string;
  state?: string;
  givenAt?: string | null;
  withdrawnAt?: string | null;
}) {
  return {
    source: input.source ?? 'beehiiv',
    sourceId: input.sourceId ?? 'source-1',
    email: input.email ?? 'member@example.org',
    newsletter: {
      state: input.state ?? 'active',
      givenAt: input.givenAt === undefined ? '2026-03-01T09:00:00.000Z' : input.givenAt,
      withdrawnAt: input.withdrawnAt ?? null,
    },
  };
}

void test('matching provider emails still require review before one person can be imported', async () => {
  const result = await preview([
    row({ sourceId: 'subscriber-1', email: ' Member@Example.org ' }),
    row({ source: 'notion_intake', sourceId: 'page-1', email: 'member@example.org' }),
    row({
      sourceId: 'subscriber-2',
      email: 'former@example.org',
      state: 'withdrawn',
      givenAt: '2025-06-01T09:00:00.000Z',
      withdrawnAt: '2026-02-01T09:00:00.000Z',
    }),
  ]);

  assert.deepEqual(result.counts, {
    records: 3,
    importablePeople: 1,
    activeMembers: 0,
    formerMembers: 1,
    unresolvedRecords: 0,
    conflictRecords: 2,
  });
  assert.equal(result.records[0]?.classification, 'conflict');
  assert.equal(result.records[1]?.classification, 'conflict');
  assert.equal(result.records[2]?.classification, 'ready');
});

void test('missing or unclear consent evidence remains unresolved', async () => {
  const result = await preview([
    row({ sourceId: 'unknown', email: 'unknown@example.org', state: 'unknown', givenAt: null }),
    row({ sourceId: 'no-date', email: 'no-date@example.org', givenAt: null }),
  ]);

  assert.equal(result.counts.importablePeople, 0);
  assert.equal(result.counts.unresolvedRecords, 2);
  assert.equal(result.counts.conflictRecords, 0);
  assert.ok(
    result.records.every(
      (entry: { classification: string }) => entry.classification === 'unresolved',
    ),
  );
});

void test('duplicate provider identities and conflicting consent histories are isolated for review', async () => {
  const result = await preview([
    row({ sourceId: 'duplicate-id', email: 'one@example.org' }),
    row({ sourceId: 'duplicate-id', email: 'two@example.org' }),
    row({ sourceId: 'active', email: 'conflict@example.org', state: 'active' }),
    row({
      source: 'notion_intake',
      sourceId: 'withdrawn',
      email: 'CONFLICT@example.org',
      state: 'withdrawn',
      givenAt: '2025-06-01T09:00:00.000Z',
      withdrawnAt: '2026-02-01T09:00:00.000Z',
    }),
  ]);

  assert.equal(result.counts.importablePeople, 0);
  assert.equal(result.counts.conflictRecords, 4);
  assert.ok(
    result.records.every(
      (entry: { classification: string }) => entry.classification === 'conflict',
    ),
  );
});

void test('invalid, future, and out-of-order consent timestamps cannot be imported', async () => {
  const result = await preview([
    row({ sourceId: 'date-only', email: 'date-only@example.org', givenAt: '2026-03-01' }),
    row({
      sourceId: 'impossible-date',
      email: 'impossible-date@example.org',
      givenAt: '2026-02-30T09:00:00.000Z',
    }),
    row({ sourceId: 'future', email: 'future@example.org', givenAt: '2026-10-10T09:00:00.000Z' }),
    row({
      sourceId: 'withdraw-before-given',
      email: 'withdraw-before-given@example.org',
      state: 'withdrawn',
      givenAt: '2026-03-01T09:00:00.000Z',
      withdrawnAt: '2026-02-01T09:00:00.000Z',
    }),
  ]);

  assert.equal(result.counts.importablePeople, 0);
  assert.equal(result.counts.conflictRecords, 4);
  assert.ok(
    result.records.every(
      (entry: { classification: string }) => entry.classification === 'conflict',
    ),
  );
});

void test('active historical consent is imported with provenance and retries do not duplicate it', async () => {
  const { memoryDb } = await import('@lasvegasfortransit/platform-storage/test-db');
  const db = memoryDb();
  const input = [row({ sourceId: 'subscriber-active' })];

  const first = await apply(db, input);
  assert.deepEqual(first.counts, {
    applied: 1,
    alreadyApplied: 0,
    needsReview: 0,
    unresolved: 0,
    conflicts: 0,
  });
  const person = db.raw.prepare('SELECT id,email,membership_status FROM people').get() as {
    id: string;
    email: string;
    membership_status: string;
  };
  assert.equal(person.email, 'member@example.org');
  assert.equal(person.membership_status, 'member');
  const consent = db.raw.prepare('SELECT * FROM consent_records').get() as Record<string, unknown>;
  assert.equal(consent.given_at, '2026-03-01T09:00:00.000Z');
  assert.equal(consent.withdrawn_at, null);
  assert.equal(consent.source, 'import');
  assert.equal(consent.method, 'unknown');
  assert.equal(consent.wording_version, null);
  assert.equal(consent.import_run_id, 'roster-run-1');
  assert.ok(consent.origin_identity_id);
  assert.equal(
    db.raw.prepare("SELECT occurred_at FROM engagement_events WHERE type='subscribed'").get()
      ?.occurred_at,
    '2026-03-01T09:00:00.000Z',
  );

  const second = await apply(db, input);
  assert.deepEqual(second.counts, {
    applied: 0,
    alreadyApplied: 1,
    needsReview: 0,
    unresolved: 0,
    conflicts: 0,
  });
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM engagement_events').get()?.n, 1);
  db.raw.close();
});

void test('a later source withdrawal updates the imported consent once', async () => {
  const { memoryDb } = await import('@lasvegasfortransit/platform-storage/test-db');
  const db = memoryDb();
  const active = [row({ sourceId: 'subscriber-transition' })];
  const first = await apply(db, active, 'roster-run-active');
  assert.equal(first.counts.applied, 1);

  const withdrawn = [
    row({
      sourceId: 'subscriber-transition',
      state: 'withdrawn',
      withdrawnAt: '2026-08-01T09:00:00.000Z',
    }),
  ];
  const second = await apply(db, withdrawn, 'roster-run-withdrawal');
  assert.equal(second.counts.applied, 1);
  assert.equal(
    db.raw.prepare('SELECT membership_status FROM people').get()?.membership_status,
    'former_member',
  );
  const consent = db.raw.prepare('SELECT * FROM consent_records').get() as Record<string, unknown>;
  assert.equal(consent.withdrawn_at, '2026-08-01T09:00:00.000Z');
  assert.equal(consent.import_run_id, 'roster-run-withdrawal');
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 1);
  assert.deepEqual(
    db.raw
      .prepare('SELECT type,occurred_at FROM engagement_events ORDER BY occurred_at')
      .all()
      .map((event) => ({ type: event.type, occurred_at: event.occurred_at })),
    [
      { type: 'subscribed', occurred_at: '2026-03-01T09:00:00.000Z' },
      { type: 'unsubscribed', occurred_at: '2026-08-01T09:00:00.000Z' },
    ],
  );

  const retry = await apply(db, withdrawn, 'roster-run-retry');
  assert.equal(retry.counts.alreadyApplied, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM engagement_events').get()?.n, 2);
  db.raw.close();
});

void test('withdrawn historical consent creates member history and a safe repeat', async () => {
  const { memoryDb } = await import('@lasvegasfortransit/platform-storage/test-db');
  const db = memoryDb();
  const input = [
    row({
      sourceId: 'subscriber-former',
      email: 'former@example.org',
      state: 'withdrawn',
      givenAt: '2025-06-01T09:00:00.000Z',
      withdrawnAt: '2026-02-01T09:00:00.000Z',
    }),
  ];

  const first = await apply(db, input);
  assert.equal(first.counts.applied, 1);
  assert.equal(
    db.raw.prepare('SELECT membership_status FROM people').get()?.membership_status,
    'former_member',
  );
  assert.deepEqual(
    db.raw
      .prepare('SELECT type,occurred_at FROM engagement_events ORDER BY occurred_at')
      .all()
      .map((event) => ({ type: event.type, occurred_at: event.occurred_at })),
    [
      { type: 'subscribed', occurred_at: '2025-06-01T09:00:00.000Z' },
      { type: 'unsubscribed', occurred_at: '2026-02-01T09:00:00.000Z' },
    ],
  );

  const second = await apply(db, input);
  assert.equal(second.counts.alreadyApplied, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM engagement_events').get()?.n, 2);
  db.raw.close();
});

void test('unresolved duplicate review blocks imported membership even on retry', async () => {
  const [{ memoryDb }, { PersonService }] = await Promise.all([
    import('@lasvegasfortransit/platform-storage/test-db'),
    import('@lasvegasfortransit/platform-storage/person-service'),
  ]);
  const db = memoryDb();
  await new PersonService(db).upsertFromSource({
    source: 'staff',
    fields: { email: 'member@example.org' },
  });
  const input = [row({ sourceId: 'unreviewed-subscriber' })];

  const first = await apply(db, input);
  assert.equal(first.counts.needsReview, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
  const second = await apply(db, input);
  assert.equal(second.counts.needsReview, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
  assert.equal(
    db.raw.prepare('SELECT count(*) AS n FROM review_queue WHERE resolved_at IS NULL').get()?.n,
    1,
  );
  db.raw.close();
});

void test('a newer consent survives an older imported withdrawal', async () => {
  const [{ memoryDb }, { PersonService }] = await Promise.all([
    import('@lasvegasfortransit/platform-storage/test-db'),
    import('@lasvegasfortransit/platform-storage/person-service'),
  ]);
  const db = memoryDb();
  const people = new PersonService(db);
  await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'member@example.org' },
    emailVerified: true,
  });
  const person = await people.findByEmail('member@example.org');
  assert.ok(person);
  await people.recordConsent(person.id, {
    scope: 'newsletter',
    source: 'join_form',
    method: 'checkbox',
    wordingVersion: 'join-form-v1',
    givenAt: '2026-08-01T09:00:00.000Z',
  });
  const input = [
    row({
      sourceId: 'stale-withdrawal',
      state: 'withdrawn',
      givenAt: '2025-06-01T09:00:00.000Z',
      withdrawnAt: '2026-02-01T09:00:00.000Z',
    }),
  ];

  const result = await apply(db, input);
  assert.equal(result.counts.applied, 1);
  assert.equal(
    db.raw.prepare('SELECT membership_status FROM people').get()?.membership_status,
    'member',
  );
  assert.equal(
    db.raw.prepare("SELECT withdrawn_at FROM consent_records WHERE source='join_form'").get()
      ?.withdrawn_at,
    null,
  );
  db.raw.close();
});

void test('an older active roster snapshot cannot restore membership after a newer withdrawal', async () => {
  const { memoryDb } = await import('@lasvegasfortransit/platform-storage/test-db');
  const { PersonService } = await import('@lasvegasfortransit/platform-storage/person-service');
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'member@example.org' },
    emailVerified: true,
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  await people.withdrawConsent(person.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: '2026-08-01T09:00:00.000Z',
  });

  const result = await apply(db, [row({ sourceId: 'stale-active' })]);
  assert.equal(result.counts.conflicts, 1);
  assert.equal(
    db.raw.prepare('SELECT membership_status FROM people').get()?.membership_status,
    'former_member',
  );
  assert.equal(
    db.raw
      .prepare('SELECT count(*) AS n FROM consent_records WHERE origin_identity_id IS NOT NULL')
      .get()?.n,
    0,
  );
  db.raw.close();
});
