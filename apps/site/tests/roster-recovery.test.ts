import assert from 'node:assert/strict';
import test from 'node:test';
import type { Db, Statement } from '@lasvegasfortransit/platform-storage/db';
import { memoryDb } from './support/platform-db';
import { applyRosterImport } from '../platform/roster-import';

const records = [
  {
    source: 'notion_intake',
    sourceId: 'synthetic-original',
    email: 'original@example.invalid',
    newsletter: {
      state: 'active',
      affirmative: true,
      givenAt: '2026-03-01T12:00:00.000Z',
      method: 'unknown',
    },
  },
];
const options = { runId: 'recovery', now: new Date('2026-10-14T12:00:00.000Z') };
function intercept(
  db: Db,
  hooks: {
    afterRun?: (sql: string) => void;
    afterFirst?: (sql: string) => void;
    beforeBatch?: (sql: string[]) => void;
    afterBatch?: (sql: string[]) => void;
  },
): Db {
  const sqlByStatement = new WeakMap<Statement, string>();
  function wrap(statement: Statement, sql: string): Statement {
    const wrapped: Statement = {
      bind: (...values) => wrap(statement.bind(...values), sql),
      first: async <T>() => {
        const result = await statement.first<T>();
        hooks.afterFirst?.(sql);
        return result;
      },
      all: () => statement.all(),
      run: async () => {
        const result = await statement.run();
        hooks.afterRun?.(sql);
        return result;
      },
    };
    sqlByStatement.set(wrapped, sql);
    sqlByStatement.set(statement, sql);
    originals.set(wrapped, statement);
    return wrapped;
  }
  const originals = new WeakMap<Statement, Statement>();
  return {
    prepare: (sql) => wrap(db.prepare(sql), sql),
    batch: async (statements) => {
      const sql = statements.map((statement) => sqlByStatement.get(statement) ?? '');
      hooks.beforeBatch?.(sql);
      const result = await db.batch(
        statements.map((statement) => originals.get(statement) ?? statement),
      );
      hooks.afterBatch?.(sql);
      return result;
    },
  };
}
void test('lost creation response resumes through the committed source identity without duplicating a person', async (context) => {
  const db = memoryDb();
  context.after(() => db.raw.close());
  let interrupted = false;
  const loseResponse = (sql: string[]) => {
    if (interrupted || !sql.some((text) => text.startsWith('INSERT INTO people'))) return;
    interrupted = true;
    throw new Error('Response lost after commit');
  };
  const flaky = intercept(db, { afterRun: (sql) => loseResponse([sql]), afterBatch: loseResponse });
  await assert.rejects(applyRosterImport(flaky, records, options), /Response lost/);
  assert.equal(interrupted, true);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM identities').get()?.n, 1);
  await applyRosterImport(db, records, options);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM identities').get()?.n, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 1);
});
void test('an actual newer opt-out arriving before the historical consent batch remains authoritative', async (context) => {
  const db = memoryDb();
  context.after(() => db.raw.close());
  let raced = false;
  const racing = intercept(db, {
    beforeBatch: (sql) => {
      if (raced || !sql.some((text) => text.startsWith('INSERT INTO consent_records'))) return;
      raced = true;
      const id = String(db.raw.prepare('SELECT id FROM people LIMIT 1').get()?.id);
      db.raw
        .prepare(
          `INSERT INTO consent_withdrawals(id,person_id,origin_person_id,scope,source,withdrawn_at,recorded_at)
      VALUES(?,?,?,'newsletter','account',?,?)`,
        )
        .run('real-withdrawal', id, id, '2026-10-01T12:00:00.000Z', '2026-10-01T12:00:00.000Z');
    },
  });
  const result = await applyRosterImport(racing, records, options);
  assert.equal(raced, true);
  assert.equal(result.counts.applied, 0);
  assert.equal(result.counts.conflicts, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
  assert.equal(
    db.raw.prepare("SELECT count(*) AS n FROM engagement_events WHERE type='subscribed'").get()?.n,
    0,
  );
  assert.equal(
    db.raw.prepare('SELECT membership_status FROM people').get()?.membership_status,
    'former_member',
  );
});
for (const side of ['candidate', 'existing'] as const)
  void test(`a duplicate review on the ${side} side appearing before consent application holds the historical choice`, async (context) => {
    const db = memoryDb();
    context.after(() => db.raw.close());
    const other = '01J00000000000000000000000X';
    db.raw
      .prepare('INSERT INTO people(id,created_at,updated_at) VALUES(?,?,?)')
      .run(other, options.now.toISOString(), options.now.toISOString());
    let raced = false;
    const racing = intercept(db, {
      beforeBatch: (sql) => {
        if (raced || !sql.some((text) => text.startsWith('INSERT INTO consent_records'))) return;
        raced = true;
        const id = String(
          db.raw.prepare('SELECT person_id FROM identities LIMIT 1').get()?.person_id,
        );
        db.raw
          .prepare(
            `INSERT INTO review_queue(id,candidate_person_id,existing_person_id,reason,created_at,updated_at)
      VALUES(?,?,?,'same phone',?,?)`,
          )
          .run(
            'late-review',
            side === 'candidate' ? id : other,
            side === 'candidate' ? other : id,
            options.now.toISOString(),
            options.now.toISOString(),
          );
      },
    });
    const result = await applyRosterImport(racing, records, options);
    assert.equal(raced, true);
    assert.equal(result.counts.applied, 0);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
  });

void test('an unverified email appearing during matching cannot produce a phantom imported profile', async (context) => {
  const db = memoryDb();
  context.after(() => db.raw.close());
  let raced = false;
  const racing = intercept(db, {
    afterFirst: (sql) => {
      if (raced || !sql.includes('SELECT id, email_verified_at AS verifiedAt')) return;
      raced = true;
      db.raw
        .prepare('INSERT INTO people(id,email,created_at,updated_at) VALUES(?,?,?,?)')
        .run(
          '01J00000000000000000000000Y',
          records[0]?.email ?? '',
          options.now.toISOString(),
          options.now.toISOString(),
        );
    },
  });
  await assert.rejects(applyRosterImport(racing, records, options), /UNIQUE/);
  assert.equal(raced, true);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
  const retry = await applyRosterImport(db, records, options);
  assert.equal(retry.counts.needsReview, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM identities').get()?.n, 0);
});
