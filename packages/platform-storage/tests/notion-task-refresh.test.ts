import assert from 'node:assert/strict';
import test from 'node:test';
import { ready, now, operation } from './support/task-checkins';
import { ensureTaskCard, attachTaskCardMessage } from '../src/notion-task-cards';
async function refresh() {
  const module = await import('../src/notion-task-refresh').catch(() => null);
  assert.ok(module, 'durable latest-card refresh work must exist');
  return module;
}
async function prepared() {
  const f = await ready();
  const card = await ensureTaskCard(
    f.db,
    { sourceId: 'source', taskId: 'task', personId: 'member' },
    now,
  );
  assert.ok(card);
  await attachTaskCardMessage(
    f.db,
    { token: card.token, channelId: '333333333333333333', messageId: '444444444444444444' },
    now,
  );
  return f;
}
void test('accepted responses queue refreshes and a newer receipt invalidates an in-flight render', async () => {
  const r = await refresh(),
    { s, db } = await prepared();
  try {
    await s.recordTaskInteraction(db, operation, now);
    const pending = await r.claimTaskCardRefresh(db, 'source', now);
    assert.ok(pending);
    assert.equal(pending.operation_state, 'queued');
    assert.equal(await r.claimTaskCardRefresh(db, 'source', now), null);
    const claim = await s.claimTaskOperation(db, operation.id, now);
    assert.ok(claim);
    await s.completeTaskOperation(
      db,
      { id: claim.id, token: claim.claim_token },
      { state: 'confirmed' },
      now,
    );
    assert.equal(await r.readTaskCardRefresh(db, pending, now), null);
    assert.equal(
      await r.claimTaskCardRefresh(db, 'source', now),
      null,
      'the old edit keeps its lock until it releases',
    );
    assert.equal(
      await r.settleTaskCardRefresh(db, pending, { state: 'confirmed' }, now),
      false,
      'an old render cannot confirm the newer generation',
    );
    const confirmed = await r.claimTaskCardRefresh(db, 'source', now);
    assert.ok(confirmed);
    assert.equal(confirmed.operation_state, 'confirmed');
    assert.equal(await r.settleTaskCardRefresh(db, confirmed, { state: 'confirmed' }, now), true);
    assert.equal(await r.claimTaskCardRefresh(db, 'source', now), null);
  } finally {
    db.raw.close();
  }
});
void test('source changes refresh existing cards even when the task is no longer actionable', async () => {
  const r = await refresh(),
    { s, db } = await prepared();
  try {
    await s.upsertNotionTaskSnapshot(
      db,
      {
        sourceId: 'source',
        taskId: 'task',
        revision: 'v2',
        active: false,
        sourceEditedAt: now.toISOString(),
        snapshot: { title: 'Done task', assigneeIds: ['notion-member'], status: 'Done' },
      },
      now,
    );
    assert.ok(await r.claimTaskCardRefresh(db, 'source', now));
  } finally {
    db.raw.close();
  }
});
void test('paused consent prevents refresh edits and erasure removes their private references', async () => {
  const r = await refresh(),
    { s, db } = await prepared();
  try {
    await s.recordTaskInteraction(db, operation, now);
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
    assert.equal(await r.claimTaskCardRefresh(db, 'source', now), null);
    db.raw
      .prepare('UPDATE people SET deleted_at=?,erased_at=? WHERE id=?')
      .run(now.toISOString(), now.toISOString(), 'member');
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM task_checkin_card_refreshes').get()?.n,
      0,
    );
  } finally {
    db.raw.close();
  }
});
void test('an interrupted edit retries safely while exhausted edits become visible terminal failures', async () => {
  const r = await refresh(),
    { s, db } = await prepared();
  try {
    await s.recordTaskInteraction(db, operation, now);
    assert.ok(await r.claimTaskCardRefresh(db, 'source', now));
    const retry = await r.claimTaskCardRefresh(db, 'source', new Date(now.getTime() + 61_000));
    assert.ok(retry);
    assert.equal(retry.attempts, 2);
    db.raw.prepare('UPDATE task_checkin_card_refreshes SET attempts=5').run();
    assert.equal(
      await r.claimTaskCardRefresh(db, 'source', new Date(now.getTime() + 122_000)),
      null,
    );
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_card_refreshes').get()?.state,
      'failed',
    );
  } finally {
    db.raw.close();
  }
});
