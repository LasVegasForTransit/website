import assert from 'node:assert/strict';
import test from 'node:test';
import { ready, now, operation } from './support/task-checkins';
async function queue() {
  const module = await import('../src/notion-task-reminders').catch(() => null);
  assert.ok(module, 'durable reminder selection must exist');
  return module;
}
void test('reminder candidates include only current consent, cohort, mapping and task authority', async () => {
  const q = await queue(),
    { s, db } = await ready();
  try {
    assert.equal((await q.listTaskReminderCandidates(db, 'source', 20)).length, 1);
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
    assert.deepEqual(await q.listTaskReminderCandidates(db, 'source', 20), []);
  } finally {
    db.raw.close();
  }
});
void test('confirmed delivery and card references commit together, and repeated schedules enqueue once', async () => {
  const q = await queue(),
    { s, db } = await ready();
  try {
    const { ensureTaskCard } = await import('../src/notion-task-cards');
    await ensureTaskCard(db, { sourceId: 'source', taskId: 'task', personId: 'member' }, now);
    const input = {
      ...operation,
      kind: 'delivery' as const,
      payload: { kind: 'pre_deadline', slot: 'pre:24', scheduledAt: now.toISOString() },
    };
    assert.equal(await s.recordTaskInteraction(db, input, now), true);
    assert.equal(await s.recordTaskInteraction(db, input, now), false);
    const claim = await s.claimTaskOperation(db, input.id, now);
    assert.ok(claim);
    assert.equal(
      await q.confirmTaskDelivery(
        db,
        claim,
        { channelId: '333333333333333333', messageId: '444444444444444444' },
        now,
      ),
      true,
    );
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'confirmed',
    );
    assert.equal(
      db.raw.prepare('SELECT message_id FROM task_checkin_cards').get()?.message_id,
      '444444444444444444',
    );
    assert.equal(
      (await q.listTaskReminderCandidates(db, 'source', 20))[0]?.last_delivery_json?.includes(
        'operation',
      ),
      true,
    );
  } finally {
    db.raw.close();
  }
});
void test('a consent change during delivery cannot attach provider references or confirm obsolete work', async () => {
  const q = await queue(),
    { s, db } = await ready();
  try {
    const { ensureTaskCard } = await import('../src/notion-task-cards');
    await ensureTaskCard(db, { sourceId: 'source', taskId: 'task', personId: 'member' }, now);
    await s.recordTaskInteraction(db, { ...operation, kind: 'delivery' }, now);
    const claim = await s.claimTaskOperation(db, operation.id, now);
    assert.ok(claim);
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
    assert.equal(
      await q.confirmTaskDelivery(
        db,
        claim,
        { channelId: '333333333333333333', messageId: '444444444444444444' },
        now,
      ),
      false,
    );
    assert.equal(
      db.raw.prepare('SELECT message_id FROM task_checkin_cards').get()?.message_id,
      null,
    );
  } finally {
    db.raw.close();
  }
});
void test('bounded queue selection finds expired effects for holding and ignores future retries', async () => {
  const q = await queue(),
    { s, db } = await ready();
  try {
    await s.recordTaskInteraction(db, operation, now);
    assert.deepEqual(
      (await q.listTaskOperationQueue(db, 'source', now, 2)).map((row) => row.id),
      ['operation'],
    );
    await s.claimTaskOperation(db, operation.id, now);
    assert.deepEqual(await q.listTaskOperationQueue(db, 'source', now, 2), []);
    assert.equal(
      (await q.listTaskOperationQueue(db, 'source', new Date(now.getTime() + 61_000), 2))[0]?.id,
      'operation',
    );
  } finally {
    db.raw.close();
  }
});
