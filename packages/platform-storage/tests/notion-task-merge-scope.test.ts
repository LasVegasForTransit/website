import assert from 'node:assert/strict';
import test from 'node:test';
import { taskMergeFixture } from './support/task-merge-fixture';
import { ensureTaskCard } from '../src/notion-task-cards';
import {
  putNotionTaskMapping,
  enqueueTaskDelivery,
  claimTaskOperation,
} from '../src/notion-task-checkins';
import { reserveTaskNotification } from '../src/notion-task-notifications';
import { queueTaskDigests } from '../src/notion-task-digests';
import { taskCheckinReview } from '../src/notion-task-admin';
void test('a merged family with two Notion accounts is quarantined for review instead of choosing an account', async () => {
  const f = await taskMergeFixture();
  try {
    await putNotionTaskMapping(
      f.db,
      {
        workspaceId: 'workspace',
        notionUserId: 'other-notion-account',
        personId: f.survivor.id,
        confirmedBy: f.actor.personId,
      },
      f.now,
    );
    await f.combine();
    assert.equal(
      await ensureTaskCard(
        f.db,
        { sourceId: 'source', taskId: 'task', personId: f.survivor.id },
        new Date(),
      ),
      null,
    );
    const review = await taskCheckinReview(f.db, f.actor, 'source');
    assert.equal(review.unmapped[0]?.notion_user_id, 'notion-member');
  } finally {
    f.db.raw.close();
  }
});
void test('a merge cannot reset notification caps or create another copy of the same daily summary', async () => {
  const f = await taskMergeFixture();
  try {
    await queueTaskDigests(f.db, { sourceId: 'source', day: '2026-10-20' }, f.now);
    f.db.raw
      .prepare(
        "INSERT INTO task_checkin_notifications(kind,operation_id,source_id,person_id,reserved_at) VALUES('delivery','prior','source',?,?)",
      )
      .run(f.merged.id, f.now.toISOString());
    await f.combine();
    assert.equal(
      await queueTaskDigests(f.db, { sourceId: 'source', day: '2026-10-20' }, new Date()),
      0,
    );
    await enqueueTaskDelivery(
      f.db,
      {
        id: 'new-delivery',
        sourceId: 'source',
        taskId: 'task',
        personId: f.survivor.id,
        taskRevision: 'v1',
        consentRevision: 1,
        policyRevision: 1,
        payload: {},
      },
      new Date(),
    );
    const claim = await claimTaskOperation(f.db, 'new-delivery', new Date());
    assert.ok(claim);
    assert.equal(
      await reserveTaskNotification(f.db, { kind: 'delivery', operation: claim }, new Date()),
      false,
    );
  } finally {
    f.db.raw.close();
  }
});
void test('erasing the current profile also removes private task history and mappings in its active merge family', async () => {
  const f = await taskMergeFixture();
  try {
    await f.combine();
    await f.people.deletePerson(f.survivor.id);
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_operations').get()?.n, 0);
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_mappings').get()?.n, 0);
    assert.equal(
      f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_consent_receipts').get()?.n,
      0,
    );
    assert.ok(
      f.db.raw.prepare('SELECT erased_at FROM people WHERE id=?').get(f.merged.id)?.erased_at,
    );
  } finally {
    f.db.raw.close();
  }
});
