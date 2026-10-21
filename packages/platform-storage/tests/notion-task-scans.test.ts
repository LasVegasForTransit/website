import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { saveTaskCheckinSource, upsertNotionTaskSnapshot } from '../src/notion-task-checkins';

const now = new Date('2026-10-20T16:00:00Z');
async function scans() {
  const module = await import('../src/notion-task-scans').catch(() => null);
  assert.ok(module, 'durable source scans must be available');
  return module;
}
async function fixture() {
  const db = memoryDb();
  db.raw
    .prepare("INSERT INTO people(id,created_at,updated_at) VALUES('staff',?,?)")
    .run(now.toISOString(), now.toISOString());
  for (const sourceId of ['source', 'other']) {
    await saveTaskCheckinSource(
      db,
      {
        sourceId,
        workspaceId: 'workspace',
        expectedRevision: 0,
        enabled: false,
        policy: {},
        actorId: 'staff',
      },
      now,
    );
    await upsertNotionTaskSnapshot(
      db,
      {
        sourceId,
        taskId: 'unseen',
        revision: 'old',
        sourceEditedAt: now.toISOString(),
        active: true,
        snapshot: { name: 'Existing' },
      },
      now,
    );
  }
  return db;
}
const snapshot = {
  taskId: 'seen',
  revision: 'new',
  sourceEditedAt: now.toISOString(),
  active: true,
  snapshot: { name: 'Current' },
};

void test('partial and failed scans preserve unseen tasks and resume the same cursor', async () => {
  const s = await scans();
  const db = await fixture();
  try {
    const first = await s.claimTaskScan(db, 'source', now);
    assert.ok(first);
    assert.equal(await s.claimTaskScan(db, 'source', now), null);
    assert.equal(
      await s.completeTaskScanPage(db, first, { tasks: [snapshot], nextCursor: 'next' }, now),
      true,
    );
    assert.equal(
      db.raw
        .prepare(
          "SELECT active FROM task_checkin_tasks WHERE source_id='source' AND task_id='unseen'",
        )
        .get()?.active,
      1,
    );
    const next = await s.claimTaskScan(db, 'source', now);
    assert.ok(next);
    assert.equal(next.cursor, 'next');
    assert.equal(next.scan_id, first.scan_id);
    await s.failTaskScan(db, next, { reason: 'provider_unavailable', retryAfterMs: 30_000 }, now);
    assert.equal(await s.claimTaskScan(db, 'source', now), null);
    const later = new Date(now.getTime() + 30_000);
    const resumed = await s.claimTaskScan(db, 'source', later);
    assert.ok(resumed);
    assert.equal(resumed.cursor, 'next');
    assert.equal(resumed.scan_id, first.scan_id);
    assert.equal(
      await s.completeTaskScanPage(db, resumed, { tasks: [], nextCursor: null }, later),
      true,
    );
    assert.equal(
      db.raw
        .prepare(
          "SELECT active FROM task_checkin_tasks WHERE source_id='source' AND task_id='unseen'",
        )
        .get()?.active,
      0,
    );
    assert.equal(
      db.raw
        .prepare(
          "SELECT active FROM task_checkin_tasks WHERE source_id='source' AND task_id='seen'",
        )
        .get()?.active,
      1,
    );
    assert.equal(
      db.raw
        .prepare(
          "SELECT active FROM task_checkin_tasks WHERE source_id='other' AND task_id='unseen'",
        )
        .get()?.active,
      1,
    );
  } finally {
    db.raw.close();
  }
});

void test('a changed policy or expired lease prevents a fetched page from changing snapshots', async () => {
  const s = await scans();
  const db = await fixture();
  try {
    const claim = await s.claimTaskScan(db, 'source', now);
    assert.ok(claim);
    await saveTaskCheckinSource(
      db,
      {
        sourceId: 'source',
        workspaceId: 'workspace',
        expectedRevision: 1,
        enabled: false,
        policy: {},
        actorId: 'staff',
      },
      now,
    );
    assert.equal(
      await s.completeTaskScanPage(db, claim, { tasks: [snapshot], nextCursor: null }, now),
      false,
    );
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM task_checkin_tasks WHERE task_id='seen'").get()?.n,
      0,
    );
    const later = new Date(now.getTime() + 60_000);
    const next = await s.claimTaskScan(db, 'source', later);
    assert.ok(next);
    assert.notEqual(next.scan_id, claim.scan_id);
    assert.equal(
      await s.completeTaskScanPage(
        db,
        next,
        { tasks: [snapshot], nextCursor: null },
        new Date(later.getTime() + 60_000),
      ),
      false,
    );
  } finally {
    db.raw.close();
  }
});

void test('an older observed version counts as seen without rolling back newer task state', async () => {
  const s = await scans();
  const db = await fixture();
  try {
    const claim = await s.claimTaskScan(db, 'source', now);
    assert.ok(claim);
    assert.equal(
      await s.completeTaskScanPage(
        db,
        claim,
        {
          tasks: [
            {
              ...snapshot,
              taskId: 'unseen',
              sourceEditedAt: '2026-10-19T12:00:00Z',
              revision: 'stale',
            },
          ],
          nextCursor: null,
        },
        now,
      ),
      true,
    );
    const row = db.raw
      .prepare(
        "SELECT active,revision FROM task_checkin_tasks WHERE source_id='source' AND task_id='unseen'",
      )
      .get();
    assert.equal(row?.active, 1);
    assert.equal(row.revision, 'old');
  } finally {
    db.raw.close();
  }
});
