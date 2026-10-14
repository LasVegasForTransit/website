import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { queryBudget } from '../src/query-budget';
import { runMaintenance } from '../src/retention';

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
