import assert from 'node:assert/strict';
import test from 'node:test';
import { ready, now } from './support/task-checkins';
import { runMaintenance } from '../src/retention';
import { claimTaskScan, completeTaskScanPage } from '../src/notion-task-scans';
import { taskRetentionWrites } from '../src/notion-task-retention';

const day = 86_400_000;
const at = (days: number) => new Date(now.getTime() + days * day);
const snapshot = {
  sourceId: 'source',
  taskId: 'task',
  revision: 'v2',
  sourceEditedAt: now.toISOString(),
  active: false,
  snapshot: { name: 'Private completed task' },
};
void test('inactive snapshots expire despite repeated scans and cannot be refilled until reopened', async () => {
  const { db, s } = await ready();
  try {
    db.raw
      .prepare(
        "UPDATE task_checkin_sources SET policy_json=json_set(policy_json,'$.retentionDays',1)",
      )
      .run();
    await s.upsertNotionTaskSnapshot(db, snapshot, now);
    await s.upsertNotionTaskSnapshot(db, snapshot, at(0.9));
    await runMaintenance(db, { now: at(1.1), category: 'records' });
    let row = db.raw.prepare("SELECT * FROM task_checkin_tasks WHERE task_id='task'").get();
    assert.equal(row?.snapshot_json, '{}', 'scan heartbeats must not extend private history');
    assert.equal(row.inactive_since, now.toISOString());
    assert.equal(row.updated_at, at(0.9).toISOString(), 'cleanup is not a new observation');
    await s.upsertNotionTaskSnapshot(db, { ...snapshot, revision: 'v3' }, at(1.2));
    const scan = await claimTaskScan(db, 'source', at(1.3));
    assert.ok(scan);
    assert.equal(
      await completeTaskScanPage(db, scan, { tasks: [snapshot], nextCursor: null }, at(1.3)),
      true,
    );
    assert.equal(
      db.raw.prepare("SELECT snapshot_json FROM task_checkin_tasks WHERE task_id='task'").get()
        ?.snapshot_json,
      '{}',
    );
    await s.upsertNotionTaskSnapshot(
      db,
      { ...snapshot, active: true, revision: 'reopened' },
      at(1.4),
    );
    row = db.raw.prepare("SELECT * FROM task_checkin_tasks WHERE task_id='task'").get();
    assert.equal(row?.snapshot_json, JSON.stringify(snapshot.snapshot));
    assert.equal(row.inactive_since, null);
    assert.equal(row.history_cleared_at, null);
  } finally {
    db.raw.close();
  }
});
void test('paused incomplete drafts preserve the last configured retention and stale active snapshots expire', async () => {
  const { db, s } = await ready();
  try {
    db.raw
      .prepare(
        "UPDATE task_checkin_sources SET policy_json=json_set(policy_json,'$.retentionDays',1)",
      )
      .run();
    await s.saveTaskCheckinSource(
      db,
      {
        sourceId: 'source',
        workspaceId: 'workspace',
        expectedRevision: 1,
        enabled: false,
        policy: {},
        actorId: 'staff',
      },
      at(0.5),
    );
    await runMaintenance(db, { now: at(1.1), category: 'records' });
    const row = db.raw.prepare("SELECT * FROM task_checkin_tasks WHERE task_id='task'").get();
    assert.equal(row?.snapshot_json, '{}');
    assert.equal(row.active, 1, 'retention must not invent task cancellation');
    assert.equal(
      db.raw.prepare('SELECT retention_days FROM task_checkin_sources').get()?.retention_days,
      1,
    );
    await s.upsertNotionTaskSnapshot(db, { ...snapshot, active: true }, at(1.2));
    assert.equal(
      db.raw.prepare('SELECT history_cleared_at FROM task_checkin_tasks').get()?.history_cleared_at,
      null,
    );
  } finally {
    db.raw.close();
  }
});
void test('only a completed scan starts the retention clock for missing tasks', async () => {
  const { db } = await ready();
  try {
    db.raw
      .prepare(
        "UPDATE task_checkin_sources SET policy_json=json_set(policy_json,'$.retentionDays',1)",
      )
      .run();
    const first = await claimTaskScan(db, 'source', now);
    assert.ok(first);
    await completeTaskScanPage(db, first, { tasks: [], nextCursor: 'more' }, now);
    assert.equal(db.raw.prepare('SELECT active FROM task_checkin_tasks').get()?.active, 1);
    const last = await claimTaskScan(db, 'source', at(0.5));
    assert.ok(last);
    await completeTaskScanPage(db, last, { tasks: [], nextCursor: null }, at(0.5));
    await runMaintenance(db, { now: at(1.1), category: 'records' });
    assert.notEqual(
      db.raw.prepare('SELECT snapshot_json FROM task_checkin_tasks').get()?.snapshot_json,
      '{}',
    );
    await runMaintenance(db, { now: at(1.6), category: 'records' });
    assert.equal(
      db.raw.prepare('SELECT snapshot_json FROM task_checkin_tasks').get()?.snapshot_json,
      '{}',
    );
  } finally {
    db.raw.close();
  }
});
void test('cleanup rotates sources, bounds each batch and skips a concurrently changed policy', async () => {
  const { db, s } = await ready();
  try {
    db.raw
      .prepare(
        "UPDATE task_checkin_sources SET policy_json=json_set(policy_json,'$.retentionDays',1)",
      )
      .run();
    await s.saveTaskCheckinSource(
      db,
      {
        sourceId: 'other',
        workspaceId: 'workspace',
        expectedRevision: 0,
        enabled: false,
        policy: { retentionDays: 1 },
        actorId: 'staff',
      },
      now,
    );
    await s.upsertNotionTaskSnapshot(
      db,
      { ...snapshot, sourceId: 'other', taskId: 'other-1' },
      now,
    );
    await s.upsertNotionTaskSnapshot(
      db,
      { ...snapshot, sourceId: 'other', taskId: 'other-2' },
      now,
    );
    await runMaintenance(db, { now: at(2), category: 'records', limit: 1 });
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM task_checkin_tasks WHERE snapshot_json='{}'").get()
        ?.n,
      1,
    );
    await runMaintenance(db, { now: at(2.1), category: 'records', limit: 1 });
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM task_checkin_tasks WHERE snapshot_json='{}'").get()
        ?.n,
      2,
    );
    const writes = await taskRetentionWrites(db, at(2.2), 1);
    db.raw.prepare('UPDATE task_checkin_sources SET revision=revision+1').run();
    await db.batch(writes);
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM task_checkin_tasks WHERE snapshot_json='{}'").get()
        ?.n,
      2,
    );
    await runMaintenance(db, { now: at(2.3), category: 'records', limit: 1 });
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM task_checkin_tasks WHERE snapshot_json='{}'").get()
        ?.n,
      3,
    );
  } finally {
    db.raw.close();
  }
});
void test('only explicit whole-day limits replace the last configured privacy period', async () => {
  const { db } = await ready();
  try {
    db.raw
      .prepare(
        "UPDATE task_checkin_sources SET policy_json=json_set(policy_json,'$.retentionDays',7)",
      )
      .run();
    for (const value of [null, 0, 366, 2.5, '90', true]) {
      db.raw
        .prepare('UPDATE task_checkin_sources SET policy_json=?')
        .run(JSON.stringify({ retentionDays: value }));
      assert.equal(
        db.raw.prepare('SELECT retention_days FROM task_checkin_sources').get()?.retention_days,
        7,
      );
    }
  } finally {
    db.raw.close();
  }
});
