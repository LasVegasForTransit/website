import assert from 'node:assert/strict';
import test from 'node:test';
import { ready, now, operation } from './support/task-checkins';
import { loadActor } from '../src/staff-roles';
async function fixture() {
  const f = await ready();
  f.db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='staff'").run();
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
  const api = await import('../src/notion-task-admin').catch(() => null);
  assert.ok(api, 'current administrator controls must exist');
  return { ...f, actor, api };
}
void test('task configuration requires current administrator authority and compare-and-set revision', async () => {
  const f = await fixture();
  try {
    const input = {
      sourceId: 'source',
      workspaceId: 'workspace',
      expectedRevision: 1,
      enabled: false,
      policy: {},
      actorId: 'staff',
    };
    assert.equal(await f.api.saveTaskCheckinConfiguration(f.db, f.actor, input, now), true);
    assert.equal(await f.api.saveTaskCheckinConfiguration(f.db, f.actor, input, now), false);
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_audits').get()?.n, 1);
    f.db.raw.prepare("DELETE FROM staff_administrators WHERE person_id='staff'").run();
    await assert.rejects(f.api.taskCheckinReview(f.db, f.actor, 'source'), /access/);
    assert.equal(
      await f.api.saveTaskCheckinConfiguration(
        f.db,
        f.actor,
        { ...input, expectedRevision: 2 },
        now,
      ),
      false,
    );
  } finally {
    f.db.raw.close();
  }
});
void test('confirming a guest mapping does not change membership or opt into messages', async () => {
  const f = await fixture();
  try {
    assert.equal(
      await f.api.confirmTaskCheckinMapping(
        f.db,
        f.actor,
        {
          sourceId: 'source',
          expectedRevision: 1,
          notionUserId: 'notion-guest',
          personId: 'guest',
        },
        now,
      ),
      true,
    );
    assert.equal(
      f.db.raw.prepare("SELECT membership_status FROM people WHERE id='guest'").get()
        ?.membership_status,
      'not_member',
    );
    assert.equal(
      f.db.raw
        .prepare("SELECT count(*) AS n FROM task_checkin_consents WHERE person_id='guest'")
        .get()?.n,
      0,
    );
    assert.equal(
      await f.api.confirmTaskCheckinMapping(
        f.db,
        f.actor,
        {
          sourceId: 'source',
          expectedRevision: 1,
          notionUserId: 'notion-guest',
          personId: 'member',
        },
        now,
      ),
      false,
    );
  } finally {
    f.db.raw.close();
  }
});
void test('safe retries reject uncertain, confirmed and stale work and audit accepted requests atomically', async () => {
  const f = await fixture();
  try {
    await f.s.recordTaskInteraction(f.db, operation, now);
    const input = {
      sourceId: 'source',
      operationId: operation.id,
      expectedUpdatedAt: now.toISOString(),
    };
    for (const state of ['held', 'confirmed', 'processing']) {
      f.db.raw.prepare('UPDATE task_checkin_operations SET state=?').run(state);
      assert.equal(await f.api.retryTaskCheckinOperation(f.db, f.actor, input, now), false);
    }
    f.db.raw.prepare("UPDATE task_checkin_operations SET state='failed',attempts=5").run();
    assert.equal(await f.api.retryTaskCheckinOperation(f.db, f.actor, input, now), true);
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'queued',
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_audits').get()?.n, 1);
    f.db.raw.prepare("UPDATE task_checkin_operations SET state='failed'").run();
    f.db.raw.exec(
      "CREATE TRIGGER reject_task_audit BEFORE INSERT ON staff_audits BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;",
    );
    await assert.rejects(
      f.api.retryTaskCheckinOperation(f.db, f.actor, input, now),
      /audit unavailable/,
    );
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'failed',
    );
    f.db.raw.exec('DROP TRIGGER reject_task_audit');
    f.db.raw.prepare("UPDATE task_checkin_tasks SET revision='v2'").run();
    assert.equal(await f.api.retryTaskCheckinOperation(f.db, f.actor, input, now), false);
  } finally {
    f.db.raw.close();
  }
});
void test('revocation at the write boundary suppresses configuration and its audit', async () => {
  const f = await fixture();
  try {
    const guarded = {
      prepare: f.db.prepare.bind(f.db),
      batch: async (statements: Parameters<typeof f.db.batch>[0]) => {
        f.db.raw.prepare("DELETE FROM staff_administrators WHERE person_id='staff'").run();
        return f.db.batch(statements);
      },
    };
    assert.equal(
      await f.api.saveTaskCheckinConfiguration(
        guarded,
        f.actor,
        {
          sourceId: 'source',
          workspaceId: 'workspace',
          expectedRevision: 1,
          enabled: false,
          policy: {},
        },
        now,
      ),
      false,
    );
    assert.equal(f.db.raw.prepare('SELECT revision FROM task_checkin_sources').get()?.revision, 1);
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_audits').get()?.n, 0);
  } finally {
    f.db.raw.close();
  }
});

void test('administrator review shows workspace identity gaps and recovery outcomes without response bodies', async () => {
  const f = await fixture();
  try {
    f.db.raw
      .prepare(
        'UPDATE task_checkin_tasks SET snapshot_json=json_set(snapshot_json,\'$.assigneeIds\',json(\'["notion-member","unmapped-guest"]\'))',
      )
      .run();
    await f.s.recordTaskInteraction(
      f.db,
      { ...operation, payload: { text: 'PRIVATE-RESPONSE-BODY' } },
      now,
    );
    f.db.raw
      .prepare("UPDATE task_checkin_operations SET state='held',reason='unconfirmed_effect'")
      .run();
    const review = await f.api.taskCheckinReview(f.db, f.actor, 'source');
    assert.equal(review.unmapped.length, 1);
    assert.equal(review.unmapped[0]?.notion_user_id, 'unmapped-guest');
    assert.equal(review.operations.items[0]?.state, 'held');
    assert.equal(review.operations.items[0].safe_retry, 0);
    assert.equal(JSON.stringify(review).includes('PRIVATE-RESPONSE-BODY'), false);
    assert.equal(JSON.stringify(review).includes('payload_json'), false);
    for (let i = 0; i < 51; i++)
      f.db.raw
        .prepare(
          `INSERT INTO task_checkin_operations(id,source_id,task_id,person_id,task_revision,consent_revision,policy_revision,kind,payload_json,state,next_attempt_at,created_at,updated_at)
      SELECT ?,source_id,task_id,person_id,task_revision,consent_revision,policy_revision,kind,payload_json,'failed',next_attempt_at,created_at,updated_at FROM task_checkin_operations WHERE id='operation'`,
        )
        .run(`retry-${String(i).padStart(2, '0')}`);
    const first = await f.api.taskCheckinReview(f.db, f.actor, 'source');
    assert.equal(first.operations.items.length, 50);
    assert.ok(first.operations.nextCursor);
    const second = await f.api.taskCheckinReview(f.db, f.actor, 'source', {
      cursor: first.operations.nextCursor,
    });
    assert.equal(second.operations.items.length, 2);
    assert.equal(second.operations.nextCursor, null);
    assert.equal(second.operations.items[0]?.safe_retry, 1);
  } finally {
    f.db.raw.close();
  }
});
