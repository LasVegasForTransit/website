import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { workspaceBudget } from '@lasvegasfortransit/platform-storage/workspace-budget';
import { workspaceDb } from './support/workspace-db';
const now = new Date('2026-11-04T20:00:00Z');
void test('missing reservation usage refuses work and retains its conservative charge', async () => {
  const db = memoryDb();
  let ran = false;
  const result = await workspaceBudget(
    db,
    'preview',
    () => {
      ran = true;
      return Promise.resolve();
    },
    now,
  );
  assert.equal(result.allowed, false);
  assert.equal(ran, false);
  assert.equal(
    db.raw.prepare('SELECT charged_reads FROM workspace_connector_budget').get()?.charged_reads,
    5000,
  );
});
void test('unverified settlement cost blocks further work instead of releasing its reservation', async () => {
  const db = memoryDb(),
    metered = workspaceDb(db);
  let batches = 0;
  const wrapped = {
    ...metered,
    batch: async (statements: Parameters<typeof metered.batch>[0]) => {
      const result = await metered.batch(statements);
      batches++;
      return batches === 2
        ? result.map((value) => ({
            ...(value as object),
            meta: { rows_read: 100, rows_written: 100 },
          }))
        : result;
    },
  };
  const result = await workspaceBudget(
    wrapped,
    'preview',
    async (database) => database.prepare('SELECT 1').all(),
    now,
  );
  assert.equal(result.allowed, false);
  assert.equal(db.raw.prepare('SELECT blocked FROM workspace_connector_budget').get()?.blocked, 1);
  assert.ok(
    Number(
      db.raw.prepare('SELECT charged_reads FROM workspace_connector_budget').get()?.charged_reads,
    ) >= 5000,
  );
});
