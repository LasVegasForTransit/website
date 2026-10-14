import assert from 'node:assert/strict';
import test from 'node:test';
import { accessFixture } from './support/access-fixture';
import { accessObservationBatchWrite } from '../src/access-observations';
import { queryBudget } from '../src/query-budget';

void test('one snapshot query keeps per-row ownership, generation, mapping and eligibility guards', async (t) => {
  const f = await accessFixture();
  t.after(() => f.db.raw.close());
  const input = f.observation;
  const budget = queryBudget(f.db, 50);
  const write = accessObservationBatchWrite(
    budget.db,
    [
      input,
      { ...input, identityId: 'other-account' },
      { ...input, identityEmail: 'other@example.invalid' },
      { ...input, generation: 99 },
      { ...input, resourceId: 'retired-role' },
      { ...input, personId: f.merged.id },
      { ...input, expectedAccess: false },
    ],
    new Date(),
    { sql: '?=1', values: [1] },
  );
  assert.ok(write);
  assert.equal((await write.run()).meta.changes, 1);
  assert.equal(budget.queries, 1);
  const blocked = accessObservationBatchWrite(budget.db, [input], new Date(), {
    sql: '?=1',
    values: [0],
  });
  assert.ok(blocked);
  assert.equal((await blocked.run()).meta.changes, 0);
  await f.committees.endAssignment(f.assigned.id, 'stepped_back', f.admin.id, 'end-batch-fixture');
  const stale = accessObservationBatchWrite(budget.db, [input], new Date(), {
    sql: '1=1',
    values: [],
  });
  assert.ok(stale);
  assert.equal((await stale.run()).meta.changes, 0);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM access_observations').get()?.n, 1);
});
void test('invalid timestamps reject the whole snapshot before executing any statement', async (t) => {
  const f = await accessFixture();
  t.after(() => f.db.raw.close());
  const budget = queryBudget(f.db, 50);
  assert.throws(
    () =>
      accessObservationBatchWrite(
        budget.db,
        [
          f.observation,
          { ...f.observation, expiresAt: new Date(Date.now() + 600_000).toISOString() },
        ],
        new Date(),
        { sql: '1=1', values: [] },
      ),
    /Invalid access observation batch/,
  );
  assert.equal(budget.queries, 0);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM access_observations').get()?.n, 0);
});
