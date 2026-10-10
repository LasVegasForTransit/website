import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import type { MemoryDb } from './support/db';
function paperCount(db: MemoryDb, table: 'engagement_events' | 'consent_records'): number {
  return Number(db.raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE source='paper'`).get()?.n);
}
const base = {
  batchId: 'paper-fixture',
  eventId: 'citynerd-fixture',
  eventName: 'CityNerd meetup',
  eventDate: '2026-10-01',
  wordingVersion: 'paper-signup-v1',
};
const row = {
  givenName: 'New',
  familyName: 'Rider',
  email: 'paper@example.invalid',
  phone: '',
  newsletterConsent: true,
};
void test('paper batches record explicit consent and attributed attendance atomically and replay without duplication', async () => {
  const { importPaperBatch } = await import('../src/paper-intake');
  const f = await mergeFixture();
  const result = await importPaperBatch(f.db, f.actor, {
    ...base,
    rows: [
      row,
      { ...row, email: 'attendance@example.invalid', newsletterConsent: false },
      { givenName: '', familyName: '', email: '', phone: '', newsletterConsent: false },
    ],
  });
  assert.equal(result.kind, 'ok');
  assert.equal(result.value.personIds.length, 2);
  const [memberId, attendeeId] = result.value.personIds;
  assert.ok(memberId && attendeeId);
  assert.equal((await f.people.getPerson(memberId))?.membership_status, 'member');
  assert.equal((await f.people.getPerson(memberId))?.email, row.email);
  assert.equal((await f.people.getPerson(attendeeId))?.membership_status, 'not_member');
  const evidence = await f.db
    .prepare('SELECT source,method,wording_version FROM consent_records WHERE person_id=?')
    .bind(memberId)
    .first();
  assert.deepEqual(
    { ...evidence },
    { source: 'paper', method: 'checkbox', wording_version: base.wordingVersion },
  );
  const attended = await f.db
    .prepare(
      "SELECT source,reference,details FROM engagement_events WHERE person_id=? AND type='attended'",
    )
    .bind(memberId)
    .first();
  assert.ok(attended);
  assert.equal(attended.source, 'paper');
  assert.equal(attended.reference, base.eventId);
  const details = JSON.parse(String(attended.details)) as Record<string, unknown>;
  assert.equal(details.actorId, f.admin.id);
  assert.equal(details.wordingVersion, base.wordingVersion);
  assert.equal(details.eventDate, base.eventDate);
  const counts = () => [
    ...f.db.raw
      .prepare(
        'SELECT (SELECT count(*) FROM people) AS people,(SELECT count(*) FROM consent_records) AS consents,(SELECT count(*) FROM engagement_events) AS events,(SELECT count(*) FROM staff_audits) AS audits',
      )
      .all(),
  ];
  const before = counts();
  assert.deepEqual(
    await importPaperBatch(f.db, f.actor, {
      ...base,
      rows: [
        row,
        { ...row, email: 'attendance@example.invalid', newsletterConsent: false },
        { givenName: '', familyName: '', email: '', phone: '', newsletterConsent: false },
      ],
    }),
    result,
  );
  assert.deepEqual(counts(), before);
  assert.equal(
    (
      await importPaperBatch(f.db, f.actor, {
        ...base,
        rows: [{ ...row, email: 'changed@example.invalid' }],
      })
    ).kind,
    'conflict',
  );
  f.db.raw.close();
});
void test('paper validation reports row errors without saving any rows and rejects unknown wording', async () => {
  const { importPaperBatch } = await import('../src/paper-intake');
  const f = await mergeFixture();
  const before = f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n;
  const result = await importPaperBatch(f.db, f.actor, {
    ...base,
    rows: [row, { ...row, email: 'bad-address' }],
  });
  assert.equal(result.kind, 'invalid');
  assert.ok(result.errors['rows.1.email']);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, before);
  assert.equal(
    (
      await importPaperBatch(f.db, f.actor, {
        ...base,
        wordingVersion: 'made-up-consent',
        rows: [row],
      })
    ).kind,
    'invalid',
  );
  assert.equal(
    (await importPaperBatch(f.db, f.actor, { ...base, rows: [row, row] })).kind,
    'invalid',
  );
  f.db.raw.close();
});
void test('paper matching keeps known contact fields and queues unverified duplicate email without taking ownership', async () => {
  const { importPaperBatch } = await import('../src/paper-intake');
  const f = await mergeFixture();
  let result = await importPaperBatch(f.db, f.actor, {
    ...base,
    rows: [{ ...row, email: f.survivor.email ?? '', givenName: 'Do not overwrite' }],
  });
  assert.equal(result.kind, 'ok');
  assert.notEqual(result.value.personIds[0], f.survivor.id);
  assert.equal(result.value.reviewIds.length, 1);
  assert.equal((await f.people.getPerson(result.value.personIds[0] ?? ''))?.email, null);
  await f.db
    .prepare('UPDATE people SET email_verified_at=? WHERE id=?')
    .bind(new Date().toISOString(), f.survivor.id)
    .run();
  result = await importPaperBatch(f.db, f.actor, {
    ...base,
    batchId: 'verified-batch',
    rows: [{ ...row, email: f.survivor.email ?? '', givenName: 'Do not overwrite' }],
  });
  assert.equal(result.kind, 'ok');
  assert.equal(result.value.personIds[0], f.survivor.id);
  assert.equal((await f.people.getPerson(f.survivor.id))?.given_name, 'Survivor');
  f.db.raw.close();
});
void test('paper audit failure rolls back people, consent, events and the batch receipt', async () => {
  const { importPaperBatch } = await import('../src/paper-intake');
  const f = await mergeFixture();
  const before = f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n;
  f.db.raw.exec(
    "CREATE TRIGGER fixture_paper_failure BEFORE INSERT ON staff_audits WHEN NEW.action='paper.import' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END",
  );
  await assert.rejects(
    importPaperBatch(f.db, f.actor, { ...base, rows: [row] }),
    /fixture rollback/,
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, before);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM paper_batches').get()?.n, 0);
  f.db.raw.close();
});
void test('older paper consent cannot undo a later withdrawal and stale staff authority cannot create records', async () => {
  const { importPaperBatch } = await import('../src/paper-intake');
  const f = await mergeFixture();
  await f.db
    .prepare('UPDATE people SET email_verified_at=? WHERE id=?')
    .bind(new Date().toISOString(), f.survivor.id)
    .run();
  await f.people.withdrawConsent(f.survivor.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: '2026-10-03T13:00:00.000Z',
  });
  const result = await importPaperBatch(f.db, f.actor, {
    ...base,
    rows: [{ ...row, email: f.survivor.email ?? '' }],
  });
  assert.equal(result.kind, 'ok');
  assert.equal((await f.people.getPerson(f.survivor.id))?.membership_status, 'former_member');
  await f.people.withdrawConsent(f.admin.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: new Date().toISOString(),
  });
  assert.equal(
    (await importPaperBatch(f.db, f.actor, { ...base, batchId: 'stale-admin', rows: [row] })).kind,
    'forbidden',
  );
  f.db.raw.close();
});
void test('simultaneous identical paper batches commit one receipt, one person and one consent', async () => {
  const { importPaperBatch } = await import('../src/paper-intake');
  const f = await mergeFixture();
  const beforePaper = paperCount(f.db, 'consent_records');
  const before = Number(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n);
  const input = { ...base, rows: [row] };
  const [first, second] = await Promise.all([
    importPaperBatch(f.db, f.actor, input),
    importPaperBatch(f.db, f.actor, input),
  ]);
  assert.equal(first.kind, 'ok');
  assert.deepEqual(second, first);
  assert.equal(Number(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n), before + 1);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM paper_batches').get()?.n, 1);
  assert.equal(paperCount(f.db, 'consent_records'), beforePaper + 1);
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='paper.import'").get()?.n,
    1,
  );
  f.db.raw.close();
});
void test('revoking membership between paper matching and the atomic write prevents the whole import', async () => {
  const { importPaperBatch } = await import('../src/paper-intake');
  const f = await mergeFixture();
  const beforePaper = paperCount(f.db, 'engagement_events');
  const before = f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n;
  const racing = {
    prepare: (sql: string) => f.db.prepare(sql),
    batch: async (statements: Parameters<typeof f.db.batch>[0]) => {
      await f.people.withdrawConsent(f.admin.id, {
        scope: 'newsletter',
        source: 'account',
        withdrawnAt: new Date().toISOString(),
      });
      return f.db.batch(statements);
    },
  };
  assert.equal(
    (await importPaperBatch(racing, f.actor, { ...base, rows: [row] })).kind,
    'forbidden',
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, before);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM paper_batches').get()?.n, 0);
  assert.equal(paperCount(f.db, 'engagement_events'), beforePaper);
  f.db.raw.close();
});
void test('paper writes fence a verified email whose ownership proof changed during matching', async () => {
  const { importPaperBatch } = await import('../src/paper-intake');
  const f = await mergeFixture();
  const beforePaper = paperCount(f.db, 'engagement_events');
  await f.db
    .prepare('UPDATE people SET email_verified_at=? WHERE id=?')
    .bind(new Date().toISOString(), f.survivor.id)
    .run();
  const racing = {
    prepare: (sql: string) => f.db.prepare(sql),
    batch: async (statements: Parameters<typeof f.db.batch>[0]) => {
      await f.db
        .prepare('UPDATE people SET email_verified_at=NULL WHERE id=?')
        .bind(f.survivor.id)
        .run();
      return f.db.batch(statements);
    },
  };
  assert.equal(
    (
      await importPaperBatch(racing, f.actor, {
        ...base,
        rows: [{ ...row, email: f.survivor.email ?? '' }],
      })
    ).kind,
    'conflict',
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM paper_batches').get()?.n, 0);
  assert.equal(paperCount(f.db, 'engagement_events'), beforePaper);
  f.db.raw.close();
});
void test('a new email claimed after matching cannot leave a partial paper import', async () => {
  const { importPaperBatch } = await import('../src/paper-intake');
  const f = await mergeFixture();
  const beforePaper = paperCount(f.db, 'consent_records');
  const racing = {
    prepare: (sql: string) => f.db.prepare(sql),
    batch: async (statements: Parameters<typeof f.db.batch>[0]) => {
      await f.create(row.email, 'Concurrent member');
      return f.db.batch(statements);
    },
  };
  assert.equal(
    (await importPaperBatch(racing, f.actor, { ...base, rows: [row] })).kind,
    'conflict',
  );
  assert.equal((await f.people.findByEmail(row.email))?.given_name, 'Concurrent member');
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM paper_batches').get()?.n, 0);
  assert.equal(paperCount(f.db, 'consent_records'), beforePaper);
  f.db.raw.close();
});
void test('lookalikes within one paper batch use the existing phone review rule', async () => {
  const { importPaperBatch } = await import('../src/paper-intake');
  const f = await mergeFixture();
  const result = await importPaperBatch(f.db, f.actor, {
    ...base,
    rows: [
      { ...row, phone: '702-555-0999' },
      { ...row, email: 'another-paper@example.invalid', phone: '(702) 555-0999' },
    ],
  });
  assert.equal(result.kind, 'ok');
  assert.equal(result.value.personIds.length, 2);
  assert.equal(result.value.reviewIds.length, 1);
  assert.equal(
    (
      await f.db
        .prepare('SELECT reason FROM review_queue WHERE id=?')
        .bind(result.value.reviewIds[0] ?? '')
        .first()
    )?.reason,
    'same phone',
  );
  f.db.raw.close();
});
void test('two sheets for the same verified person and event preserve one attendance record', async () => {
  const { importPaperBatch } = await import('../src/paper-intake');
  const f = await mergeFixture();
  await f.db
    .prepare('UPDATE people SET email_verified_at=? WHERE id=?')
    .bind(new Date().toISOString(), f.survivor.id)
    .run();
  for (const batchId of ['first-sheet', 'second-sheet'])
    assert.equal(
      (
        await importPaperBatch(f.db, f.actor, {
          ...base,
          batchId,
          rows: [{ ...row, email: f.survivor.email ?? '' }],
        })
      ).kind,
      'ok',
    );
  assert.equal(
    (
      await f.db
        .prepare(
          "SELECT count(*) AS n FROM engagement_events WHERE person_id=? AND type='attended' AND source='paper' AND reference=?",
        )
        .bind(f.survivor.id, base.eventId)
        .first()
    )?.n,
    1,
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM paper_batches').get()?.n, 2);
  f.db.raw.close();
});
