import assert from 'node:assert/strict';
import test from 'node:test';
import { ready, now } from './support/task-checkins';
async function digests() {
  const module = await import('../src/notion-task-digests').catch(() => null);
  assert.ok(module, 'durable per-person digest receipts must exist');
  return module;
}
void test('daily digest queue is private per recipient, idempotent and fenced by current consent', async () => {
  const d = await digests(),
    { s, db } = await ready();
  try {
    assert.equal(await d.queueTaskDigests(db, { sourceId: 'source', day: '2026-10-20' }, now), 1);
    assert.equal(await d.queueTaskDigests(db, { sourceId: 'source', day: '2026-10-20' }, now), 0);
    const claim = await d.claimTaskDigest(db, 'source', now);
    assert.ok(claim);
    assert.equal(claim.person_id, 'member');
    assert.equal((await d.readTaskDigestContext(db, claim, now))?.notion_user_id, 'notion-member');
    assert.equal(await d.claimTaskDigest(db, 'source', now), null);
    await s.setTaskCheckinConsent(
      db,
      {
        sourceId: 'source',
        personId: 'member',
        discordUserId: '111111111111111111',
        interactionId: '100000000000000100',
        state: 'paused',
        policyRevision: 1,
      },
      now,
    );
    assert.equal(await d.readTaskDigestContext(db, claim, now), null);
  } finally {
    db.raw.close();
  }
});
void test('uncertain digests are held on lease expiry and cannot be silently replayed', async () => {
  const d = await digests(),
    { db } = await ready();
  try {
    await d.queueTaskDigests(db, { sourceId: 'source', day: '2026-10-20' }, now);
    assert.ok(await d.claimTaskDigest(db, 'source', now));
    assert.equal(await d.claimTaskDigest(db, 'source', new Date(now.getTime() + 61_000)), null);
    assert.equal(db.raw.prepare('SELECT state FROM task_checkin_digests').get()?.state, 'held');
    assert.equal(
      await d.queueTaskDigests(
        db,
        { sourceId: 'source', day: '2026-10-20' },
        new Date(now.getTime() + 61_000),
      ),
      0,
    );
  } finally {
    db.raw.close();
  }
});
void test('task lists omit other assignees, inactive tasks and per-person snoozes', async () => {
  const d = await digests(),
    { s, db } = await ready();
  try {
    await d.queueTaskDigests(db, { sourceId: 'source', day: '2026-10-20' }, now);
    const claim = await d.claimTaskDigest(db, 'source', now);
    assert.ok(claim);
    assert.equal((await d.listTaskDigestTasks(db, claim, now)).length, 1);
    await s.upsertNotionTaskSnapshot(
      db,
      {
        sourceId: 'source',
        taskId: 'private',
        revision: 'x',
        active: true,
        sourceEditedAt: now.toISOString(),
        snapshot: { assigneeIds: ['someone-else'] },
      },
      now,
    );
    assert.equal((await d.listTaskDigestTasks(db, claim, now)).length, 1);
    const { ensureTaskCard } = await import('../src/notion-task-cards');
    await ensureTaskCard(db, { sourceId: 'source', taskId: 'task', personId: 'member' }, now);
    db.raw
      .prepare('UPDATE task_checkin_cards SET snoozed_until=?')
      .run(new Date(now.getTime() + 60_000).toISOString());
    assert.equal((await d.listTaskDigestTasks(db, claim, now)).length, 0);
  } finally {
    db.raw.close();
  }
});
void test('digest deferral preserves attempts and person erasure removes digest references', async () => {
  const d = await digests(),
    { db } = await ready();
  try {
    await d.queueTaskDigests(db, { sourceId: 'source', day: '2026-10-20' }, now);
    const claim = await d.claimTaskDigest(db, 'source', now);
    assert.ok(claim);
    await d.settleTaskDigest(db, claim, { state: 'deferred' }, now);
    assert.equal(db.raw.prepare('SELECT attempts FROM task_checkin_digests').get()?.attempts, 0);
    db.raw
      .prepare('UPDATE people SET erased_at=?,deleted_at=? WHERE id=?')
      .run(now.toISOString(), now.toISOString(), 'member');
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM task_checkin_digests').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});
