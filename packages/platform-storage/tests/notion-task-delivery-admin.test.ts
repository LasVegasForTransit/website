import assert from 'node:assert/strict';
import test from 'node:test';
import { ready, now } from './support/task-checkins';
import { loadActor } from '../src/staff-roles';
import { queueTaskDigests } from '../src/notion-task-digests';
import { ensureTaskCard, attachTaskCardMessage } from '../src/notion-task-cards';
import { taskCheckinReview } from '../src/notion-task-admin';
async function fixture() {
  const f = await ready();
  f.db.raw.exec("UPDATE people SET membership_status='member' WHERE id='staff'");
  f.db.raw
    .prepare(
      "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('staff','staff',?)",
    )
    .run(now.toISOString());
  f.db.raw
    .prepare(
      "INSERT INTO people(id,membership_status,created_at,updated_at) VALUES('backup','member',?,?)",
    )
    .run(now.toISOString(), now.toISOString());
  f.db.raw
    .prepare(
      "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('backup','staff',?)",
    )
    .run(now.toISOString());
  const actor = await loadActor(f.db, 'staff');
  assert.ok(actor);
  await queueTaskDigests(f.db, { sourceId: 'source', day: '2026-10-20' }, now);
  const card = await ensureTaskCard(
    f.db,
    { sourceId: 'source', taskId: 'task', personId: 'member' },
    now,
  );
  assert.ok(card);
  await attachTaskCardMessage(
    f.db,
    { token: card.token, channelId: 'PRIVATE-CHANNEL', messageId: 'PRIVATE-MESSAGE' },
    now,
  );
  f.db.raw
    .prepare(
      "UPDATE task_checkin_digests SET state='held',reason='unconfirmed_effect',result_json=?",
    )
    .run(JSON.stringify({ channelId: 'PRIVATE-CHANNEL' }));
  f.db.raw
    .prepare(
      `INSERT INTO task_checkin_card_refreshes(source_id,task_id,person_id,state,reason,next_attempt_at,updated_at)
    VALUES('source','task','member','failed','provider_unavailable',?,?) ON CONFLICT(source_id,task_id,person_id)
    DO UPDATE SET state='failed',reason='provider_unavailable'`,
    )
    .run(now.toISOString(), now.toISOString());
  return { ...f, actor };
}
void test('failed summaries and card edits appear in authorized bounded review without DM routing data', async () => {
  const f = await fixture();
  try {
    const review = await taskCheckinReview(f.db, f.actor, 'source');
    assert.ok(review.deliveryIssues, 'non-operation delivery failures must be visible');
    assert.deepEqual(
      review.deliveryIssues.items.map((item) => item.kind),
      ['digest', 'refresh'],
    );
    assert.equal(review.deliveryIssues.items[0]?.safe_retry, 0);
    assert.equal(review.deliveryIssues.items[1]?.safe_retry, 1);
    assert.ok(!JSON.stringify(review.deliveryIssues).includes('PRIVATE-'));
  } finally {
    f.db.raw.close();
  }
});
void test('uncertain summaries can be closed without resending; known card edits retry with current authority and CAS', async () => {
  const f = await fixture();
  try {
    const api = await import('../src/notion-task-delivery-admin').catch(() => null);
    assert.ok(api, 'delivery recovery actions must exist');
    const review = await taskCheckinReview(f.db, f.actor, 'source');
    const digest = review.deliveryIssues.items.find((item) => item.kind === 'digest');
    assert.ok(digest);
    const refresh = review.deliveryIssues.items.find((item) => item.kind === 'refresh');
    assert.ok(refresh);
    assert.ok(refresh.generation !== null);
    const refreshGeneration = refresh.generation;
    const input = (row: typeof digest) => ({
      sourceId: 'source',
      kind: row.kind,
      id: row.id,
      expectedUpdatedAt: row.updated_at,
      expectedGeneration: row.generation,
    });
    assert.equal(await api.retryTaskDeliveryIssue(f.db, f.actor, input(digest), now), false);
    assert.equal(await api.closeTaskDeliveryIssue(f.db, f.actor, input(digest), now), true);
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_digests').get()?.state,
      'superseded',
    );
    assert.equal(await api.retryTaskDeliveryIssue(f.db, f.actor, input(refresh), now), true);
    assert.equal(await api.retryTaskDeliveryIssue(f.db, f.actor, input(refresh), now), false);
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_card_refreshes').get()?.state,
      'queued',
    );
    assert.equal(
      f.db.raw.prepare('SELECT generation FROM task_checkin_card_refreshes').get()?.generation,
      refreshGeneration + 1,
    );
    f.db.raw.exec(
      "UPDATE task_checkin_card_refreshes SET state='failed'; DELETE FROM staff_administrators WHERE person_id='staff'",
    );
    assert.equal(
      await api.retryTaskDeliveryIssue(
        f.db,
        f.actor,
        { ...input(refresh), expectedGeneration: refreshGeneration + 1 },
        now,
      ),
      false,
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_audits').get()?.n, 2);
  } finally {
    f.db.raw.close();
  }
});
