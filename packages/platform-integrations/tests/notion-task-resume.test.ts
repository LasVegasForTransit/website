import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, sourceId } from './support/task-action-fixture';
import { taskPolicy } from './support/task-checkins';
import { queueTaskReminders } from '../src/notion-task-delivery';
import { configureTaskCheckins } from '../src/notion-task-admin';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import { setTaskCheckinConsent } from '@lasvegasfortransit/platform-storage/notion-task-checkins';
const at = new Date('2026-10-23T18:00:00Z');
void test('unchanged source pause and resume do not recreate either a confirmed or superseded reminder', async () => {
  for (const state of ['confirmed', 'queued']) {
    const db = await fixture();
    try {
      db.raw.prepare('DELETE FROM task_checkin_operations').run();
      db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='member'").run();
      db.raw
        .prepare(
          "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('member','member',?)",
        )
        .run(at.toISOString());
      const actor = await loadActor(db, 'member');
      assert.ok(actor);
      assert.equal((await queueTaskReminders(db, sourceId, () => at)).queued, 1);
      db.raw.prepare('UPDATE task_checkin_operations SET state=?').run(state);
      for (const [expectedRevision, enabled] of [
        [1, false],
        [2, true],
      ] as const) {
        assert.equal(
          (
            await configureTaskCheckins(
              db,
              actor,
              { sourceId, workspaceId: 'workspace', expectedRevision, enabled, policy: taskPolicy },
              at,
            )
          ).kind,
          'ok',
        );
      }
      assert.equal(
        (await queueTaskReminders(db, sourceId, () => new Date(at.getTime() + 60_000))).queued,
        0,
        `${state} reminder must not replay`,
      );
      assert.equal(db.raw.prepare('SELECT count(*) AS n FROM task_checkin_operations').get()?.n, 1);
      assert.equal(
        (await queueTaskReminders(db, sourceId, () => new Date('2026-10-25T18:00:00Z'))).queued,
        1,
        'a later reminder slot remains available',
      );
    } finally {
      db.raw.close();
    }
  }
});
void test('a renewed self opt-in retains reminder history and future follow-ups without repeating the original card', async () => {
  const db = await fixture();
  try {
    db.raw.prepare('DELETE FROM task_checkin_operations').run();
    assert.equal((await queueTaskReminders(db, sourceId, () => at)).queued, 1);
    db.raw.prepare("UPDATE task_checkin_operations SET state='confirmed'").run();
    for (const [state, id] of [
      ['paused', '100000000000000100'],
      ['active', '100000000000000200'],
    ] as const) {
      assert.equal(
        await setTaskCheckinConsent(
          db,
          {
            sourceId,
            personId: 'member',
            discordUserId: '111111111111111111',
            policyRevision: 1,
            interactionId: id,
            state,
          },
          at,
        ),
        true,
      );
    }
    assert.equal(
      (await queueTaskReminders(db, sourceId, () => new Date(at.getTime() + 60_000))).queued,
      0,
    );
    assert.equal(
      (await queueTaskReminders(db, sourceId, () => new Date('2026-10-24T18:01:00Z'))).queued,
      1,
      'the unanswered follow-up uses actual prior delivery history',
    );
    assert.equal(
      (await queueTaskReminders(db, sourceId, () => new Date('2026-10-24T18:02:00Z'))).queued,
      0,
    );
  } finally {
    db.raw.close();
  }
});
