import assert from 'node:assert/strict';
import test from 'node:test';
import { ready, now } from './support/task-checkins';
import { loadActor } from '../src/staff-roles';
import { taskCheckinReview } from '../src/notion-task-admin';
async function fixture() {
  const f = await ready();
  f.db.raw.exec("UPDATE people SET membership_status='member' WHERE id='staff'");
  f.db.raw
    .prepare(
      "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('staff','staff',?)",
    )
    .run(now.toISOString());
  const actor = await loadActor(f.db, 'staff');
  assert.ok(actor);
  return { ...f, actor };
}
void test('staff see actionable held tasks but not ordinary completed or archived work', async () => {
  const f = await fixture();
  try {
    for (const [taskId, reason, status] of [
      ['range', 'unconfirmed_date_range', 'In progress'],
      ['name', 'missing_name', 'Not started'],
      ['done', 'missing_name', 'Done'],
      ['archive', 'archived', 'In progress'],
    ] as const)
      await f.s.upsertNotionTaskSnapshot(
        f.db,
        {
          sourceId: 'source',
          taskId,
          revision: 'v1',
          sourceEditedAt: now.toISOString(),
          active: false,
          snapshot: { title: taskId, ineligibleReason: reason, status },
        },
        now,
      );
    const review = await taskCheckinReview(f.db, f.actor, 'source');
    assert.ok(review.heldTasks, 'held task outcomes must be visible to current administrators');
    assert.deepEqual(
      review.heldTasks.items.map((item) => item.task_id),
      ['name', 'range'],
    );
    const outsider = await loadActor(f.db, 'guest');
    assert.ok(outsider);
    await assert.rejects(taskCheckinReview(f.db, outsider, 'source'), /access/);
  } finally {
    f.db.raw.close();
  }
});
void test('staff can distinguish source-specific choices and renewed-consent readiness without changing them', async () => {
  const f = await fixture();
  try {
    let review = await taskCheckinReview(f.db, f.actor, 'source');
    assert.ok(review.participants, 'participant choices must be operationally visible');
    assert.equal(review.participants.items[0]?.preference_state, 'active');
    assert.equal(review.participants.items[0].consent_current, 1);
    await f.s.saveTaskCheckinSource(
      f.db,
      {
        sourceId: 'source',
        workspaceId: 'workspace',
        expectedRevision: 1,
        enabled: true,
        policy: { cohortPersonIds: ['member', 'guest'] },
        actorId: 'staff',
      },
      now,
    );
    review = await taskCheckinReview(f.db, f.actor, 'source');
    const member = review.participants.items.find((item) => item.person_id === 'member');
    assert.equal(member?.consent_current, 0);
    const guest = review.participants.items.find((item) => item.person_id === 'guest');
    assert.equal(guest?.preference_state, null);
    assert.equal(guest.identity_ready, 0);
    await f.s.setTaskCheckinConsent(
      f.db,
      {
        sourceId: 'source',
        personId: 'member',
        discordUserId: '111111111111111111',
        interactionId: '100000000000000100',
        state: 'opted_out',
        policyRevision: 2,
      },
      now,
    );
    review = await taskCheckinReview(f.db, f.actor, 'source');
    assert.equal(
      review.participants.items.find((item) => item.person_id === 'member')?.preference_state,
      'opted_out',
    );
    assert.equal(
      f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_consent_receipts').get()?.n,
      2,
    );
  } finally {
    f.db.raw.close();
  }
});
