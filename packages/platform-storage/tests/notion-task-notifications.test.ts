import assert from 'node:assert/strict';
import test from 'node:test';
import { now, ready, operation } from './support/task-checkins';
import { enqueueTaskDelivery, claimTaskOperation } from '../src/notion-task-operations';
import { queueTaskDigests, claimTaskDigest } from '../src/notion-task-digests';

async function fixture() {
  const { db } = await ready();
  db.raw
    .prepare(
      `UPDATE task_checkin_sources SET policy_json=json_set(policy_json,
    '$.notificationLimit24h',2,'$.notificationGapMinutes',60)`,
    )
    .run();
  await enqueueTaskDelivery(db, { ...operation, id: 'reminder', payload: {} }, now);
  const reminder = await claimTaskOperation(db, 'reminder', now);
  assert.ok(reminder);
  return { db, reminder };
}
void test('reminders and summaries share an atomic per-person rolling limit and spacing rule', async () => {
  const api = await import('../src/notion-task-notifications').catch(() => null);
  assert.ok(api, 'notification reservations must guard all send types');
  const { db, reminder } = await fixture();
  try {
    assert.equal(
      await api.reserveTaskNotification(db, { kind: 'delivery', operation: reminder }, now),
      true,
    );
    await queueTaskDigests(db, { sourceId: 'source', day: '2026-10-20' }, now);
    const digest = await claimTaskDigest(db, 'source', now);
    assert.ok(digest);
    assert.equal(
      await api.reserveTaskNotification(db, { kind: 'digest', operation: digest }, now),
      false,
    );
    const later = new Date(now.getTime() + 3_600_000);
    db.raw
      .prepare('UPDATE task_checkin_digests SET lease_expires_at=?')
      .run(new Date(later.getTime() + 60_000).toISOString());
    assert.equal(
      await api.reserveTaskNotification(db, { kind: 'digest', operation: digest }, later),
      true,
    );
    const capped = new Date(later.getTime() + 3_600_000);
    await enqueueTaskDelivery(db, { ...operation, id: 'another', payload: {} }, capped);
    const third = await claimTaskOperation(db, 'another', capped);
    assert.ok(third);
    assert.equal(
      await api.reserveTaskNotification(db, { kind: 'delivery', operation: third }, capped),
      false,
    );
    const tomorrow = new Date(now.getTime() + 86_400_001);
    db.raw
      .prepare('UPDATE task_checkin_operations SET lease_expires_at=? WHERE id=?')
      .run(new Date(tomorrow.getTime() + 60_000).toISOString(), third.id);
    assert.equal(
      await api.reserveTaskNotification(db, { kind: 'delivery', operation: third }, tomorrow),
      true,
    );
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM task_checkin_notifications').get()?.n,
      3,
    );
    db.raw
      .prepare('UPDATE people SET erased_at=?,deleted_at=? WHERE id=?')
      .run(now.toISOString(), now.toISOString(), 'member');
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM task_checkin_notifications').get()?.n,
      0,
    );
  } finally {
    db.raw.close();
  }
});
void test('missing limits, expired claims and revoked consent cannot reserve a send', async () => {
  const api = await import('../src/notion-task-notifications').catch(() => null);
  assert.ok(api);
  const { db, reminder } = await fixture();
  try {
    db.raw
      .prepare(
        "UPDATE task_checkin_sources SET policy_json=json_remove(policy_json,'$.notificationLimit24h')",
      )
      .run();
    assert.equal(
      await api.reserveTaskNotification(db, { kind: 'delivery', operation: reminder }, now),
      false,
    );
    db.raw
      .prepare(
        "UPDATE task_checkin_sources SET policy_json=json_set(policy_json,'$.notificationLimit24h',2)",
      )
      .run();
    assert.equal(
      await api.reserveTaskNotification(
        db,
        { kind: 'delivery', operation: { ...reminder, claim_token: 'wrong' } },
        now,
      ),
      false,
    );
    assert.equal(
      await api.reserveTaskNotification(
        db,
        { kind: 'delivery', operation: reminder },
        new Date(now.getTime() + 60_000),
      ),
      false,
    );
    db.raw.prepare("UPDATE task_checkin_consents SET state='paused'").run();
    assert.equal(
      await api.reserveTaskNotification(db, { kind: 'delivery', operation: reminder }, now),
      false,
    );
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM task_checkin_notifications').get()?.n,
      0,
    );
  } finally {
    db.raw.close();
  }
});
