import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { queryBudget } from '../src/query-budget';
import { runMaintenance } from '../src/retention';
import { newsletterErasureWrites } from '../src/newsletter-erasure';

void test('atomic profile erasure fits its own Free invocation without unrelated audit statements', async () => {
  const native = memoryDb();
  try {
    native.raw.exec(
      "INSERT INTO people(id,given_name,email,created_at,updated_at,deleted_at) VALUES('legacy','Legacy private','legacy@example.invalid','2000-01-01','2000-01-01','2000-01-01')",
    );
    const budget = queryBudget(native, 50);
    const result = await runMaintenance(budget.db, { category: 'profiles' });
    assert.equal(result.profilesErased, 1);
    assert.equal(result.profilesRemoved, 1);
    assert.equal(budget.queries, 50);
    assert.equal(native.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
    assert.equal(native.raw.prepare('SELECT count(*) AS n FROM person_erasure_scope').get()?.n, 0);
    assert.equal(
      native.raw.prepare('SELECT count(*) AS n FROM person_retention_scope').get()?.n,
      0,
    );
  } finally {
    native.raw.close();
  }
});
void test('audit maintenance fits its own budget and leaves profile erasure to its atomic pass', async () => {
  const native = memoryDb();
  try {
    native.raw.exec(
      "INSERT INTO people(id,given_name,created_at,updated_at,deleted_at) VALUES('legacy','Legacy private','2000-01-01','2000-01-01','2000-01-01')",
    );
    const budget = queryBudget(native, 50);
    const result = await runMaintenance(budget.db, { category: 'records' });
    assert.equal(result.profilesErased, 0);
    assert.equal(result.profilesRemoved, 0);
    assert.ok(budget.queries < 50);
    assert.equal(
      native.raw.prepare('SELECT given_name FROM people').get()?.given_name,
      'Legacy private',
    );
    assert.equal(native.raw.prepare('SELECT count(*) AS n FROM audit_retention_scope').get()?.n, 0);
  } finally {
    native.raw.close();
  }
});

void test('a pre-inbox schema can reuse its observed absence without newsletter cleanup', async () => {
  const native = memoryDb('0035_newsletter_write_recovery.sql');
  try {
    const inboxPresent = Boolean(
      await native
        .prepare("SELECT 1 FROM sqlite_master WHERE name='newsletter_inbound_events'")
        .first(),
    );
    assert.equal(inboxPresent, false);
    assert.deepEqual(
      await newsletterErasureWrites(
        native,
        {
          sql: 'SELECT id FROM people WHERE id=? AND erased_at IS NULL',
          values: ['person'],
          knownInboxPresence: inboxPresent,
        },
        'erasure',
        '2026-10-18',
      ),
      [],
    );
    assert.deepEqual(await newsletterErasureWrites(native, 'person', 'erasure', '2026-10-18'), []);
  } finally {
    native.raw.close();
  }
});
void test('an observed inbox still requires its erasure migration', async () => {
  const native = memoryDb('0036_newsletter_inbound.sql');
  try {
    const inboxPresent = Boolean(
      await native
        .prepare("SELECT 1 FROM sqlite_master WHERE name='newsletter_inbound_events'")
        .first(),
    );
    assert.equal(inboxPresent, true);
    const writes = await newsletterErasureWrites(
      native,
      {
        sql: 'SELECT id FROM people WHERE id=? AND erased_at IS NULL',
        values: ['person'],
        knownInboxPresence: inboxPresent,
      },
      'erasure',
      '2026-10-18',
    );
    await assert.rejects(native.batch(writes), /no such table: newsletter_erasure_checks/);
  } finally {
    native.raw.close();
  }
});
