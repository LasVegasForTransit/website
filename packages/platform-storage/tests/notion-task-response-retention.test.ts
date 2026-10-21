import assert from 'node:assert/strict';
import test from 'node:test';
import { ready, now, operation } from './support/task-checkins';
import { runMaintenance } from '../src/retention';
import { listTaskReminderCandidates } from '../src/notion-task-reminders';
import { listTaskEscalationCandidates } from '../src/notion-task-escalation-candidates';
import {
  queueTaskEscalation,
  claimTaskEscalation,
  readTaskEscalationContext,
} from '../src/notion-task-escalations';
import { loadActor } from '../src/staff-roles';
import { retryTaskCheckinOperation, taskCheckinReview } from '../src/notion-task-admin';

const expired = new Date(now.getTime() + 90_000_000);
async function fixture() {
  const f = await ready();
  f.db.raw
    .prepare(
      "UPDATE task_checkin_sources SET policy_json=json_set(policy_json,'$.retentionDays',1)",
    )
    .run();
  return f;
}
function observe(db: Awaited<ReturnType<typeof fixture>>['db']) {
  db.raw.prepare('UPDATE task_checkin_tasks SET updated_at=?').run(expired.toISOString());
}
void test('expired human text and provider references are scrubbed while confirmed delivery receipts still deduplicate', async () => {
  const { db, s } = await fixture();
  try {
    await s.recordTaskInteraction(db, operation, now);
    await s.recordTaskInteraction(
      db,
      {
        ...operation,
        id: 'delivery',
        kind: 'delivery',
        payload: {
          kind: 'pre_deadline',
          slot: 'pre:24',
          scheduledAt: now.toISOString(),
          policyKey: 'policy-digest',
        },
      },
      now,
    );
    db.raw
      .prepare("UPDATE task_checkin_operations SET state='confirmed',result_json=?")
      .run(JSON.stringify({ channelId: 'private-channel', providerId: 'provider-reference' }));
    observe(db);
    await runMaintenance(db, { now: expired, category: 'records' });
    const row = db.raw
      .prepare('SELECT * FROM task_checkin_operations WHERE id=?')
      .get(operation.id);
    assert.equal(row?.payload_json, '{}');
    assert.equal(row.result_json, null);
    assert.equal(row.created_at, now.toISOString());
    assert.equal(row.updated_at, now.toISOString(), 'redaction must not look like a new reply');
    assert.equal(row.state, 'confirmed');
    assert.equal(
      db.raw
        .prepare(
          "SELECT json_extract(payload_json,'$.policyKey') AS policy FROM task_checkin_operations WHERE id='delivery'",
        )
        .get()?.policy,
      'policy-digest',
    );
    assert.equal(
      await s.recordTaskInteraction(
        db,
        { ...operation, id: 'delivery', kind: 'delivery' },
        expired,
      ),
      false,
    );
    const candidate = (await listTaskReminderCandidates(db, 'source', 1))[0];
    assert.ok(candidate);
    assert.ok(candidate.last_delivery_json?.includes(now.toISOString()));
    assert.equal(candidate.last_response_at, now.toISOString());
  } finally {
    db.raw.close();
  }
});
void test('old queued human responses cannot be claimed even before maintenance reaches them', async () => {
  const { db, s } = await fixture();
  try {
    await s.recordTaskInteraction(db, operation, now);
    observe(db);
    assert.equal(await s.claimTaskOperation(db, operation.id, expired), null);
    await runMaintenance(db, { now: expired, category: 'records' });
    const row = db.raw.prepare('SELECT * FROM task_checkin_operations').get();
    assert.equal(row?.state, 'failed');
    assert.equal(row.reason, 'retention_expired');
    assert.equal(row.payload_json, '{}');
    assert.equal(await s.claimTaskOperation(db, operation.id, expired), null);
  } finally {
    db.raw.close();
  }
});
void test('maintenance leaves a live provider lease intact and holds an expired one without replaying it', async () => {
  const { db, s } = await fixture();
  try {
    await s.recordTaskInteraction(db, operation, now);
    const claim = await s.claimTaskOperation(db, operation.id, now);
    assert.ok(claim);
    const until = new Date(expired.getTime() + 60_000);
    db.raw
      .prepare('UPDATE task_checkin_operations SET lease_expires_at=?')
      .run(until.toISOString());
    observe(db);
    await runMaintenance(db, { now: expired, category: 'records' });
    assert.equal(
      db.raw.prepare('SELECT payload_json FROM task_checkin_operations').get()?.payload_json,
      JSON.stringify(operation.payload),
    );
    assert.equal(
      await s.readTaskActionContext(db, claim, expired),
      null,
      'age must also fence the final effect boundary',
    );
    await runMaintenance(db, { now: until, category: 'records' });
    const row = db.raw.prepare('SELECT * FROM task_checkin_operations').get();
    assert.equal(row?.state, 'held');
    assert.equal(row.reason, 'unconfirmed_effect');
    assert.equal(row.payload_json, '{}');
    assert.equal(await s.claimTaskOperation(db, operation.id, until), null);
  } finally {
    db.raw.close();
  }
});
void test('redacted ambiguous comments can still be positively reconciled and never reposted', async () => {
  const { db, s } = await fixture();
  try {
    await s.recordTaskInteraction(db, operation, now);
    db.raw
      .prepare("UPDATE task_checkin_operations SET state='held',reason='unconfirmed_effect'")
      .run();
    observe(db);
    await runMaintenance(db, { now: expired, category: 'records' });
    assert.equal((await s.readHeldTaskComment(db, operation.id))?.payload_json, '{}');
    assert.equal(
      await s.confirmHeldTaskComment(db, operation.id, 'positive-provider-marker', expired),
      true,
    );
    await runMaintenance(db, { now: expired, category: 'records' });
    assert.equal(
      db.raw.prepare('SELECT result_json FROM task_checkin_operations').get()?.result_json,
      null,
    );
    assert.equal(await s.claimTaskOperation(db, operation.id, expired), null);
  } finally {
    db.raw.close();
  }
});
void test('expired blocker text is not revived as a new support notification', async () => {
  const { db, s } = await fixture();
  try {
    db.raw
      .prepare(
        `UPDATE task_checkin_sources SET policy_json=json_set(policy_json,
      '$.supportPersonIds',json('["member"]'),'$.escalation','support','$.escalationContentApproved',json('true'))`,
      )
      .run();
    await s.recordTaskInteraction(db, { ...operation, kind: 'blocker' }, now);
    db.raw.prepare("UPDATE task_checkin_operations SET state='confirmed'").run();
    await queueTaskEscalation(
      db,
      {
        eventKey: 'help',
        sourceId: 'source',
        taskId: 'task',
        subjectId: 'member',
        taskRevision: 'v1',
        consentRevision: 1,
        policyRevision: 1,
        trigger: 'blocker',
        blockerId: operation.id,
        recipients: [{ key: 'person:member', personId: 'member', notionId: null }],
      },
      now,
    );
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_escalations').get()?.state,
      'queued',
    );
    const claim = await claimTaskEscalation(db, 'source', now);
    assert.ok(claim);
    db.raw
      .prepare('UPDATE task_checkin_escalations SET lease_expires_at=?')
      .run(new Date(expired.getTime() + 60_000).toISOString());
    observe(db);
    assert.equal((await listTaskEscalationCandidates(db, 'source', expired))[0]?.blocker_id, null);
    assert.equal(await readTaskEscalationContext(db, claim, expired), null);
    await runMaintenance(db, { now: expired, category: 'records' });
    assert.equal((await listTaskEscalationCandidates(db, 'source', expired))[0]?.blocker_id, null);
    assert.equal(await claimTaskEscalation(db, 'source', expired), null);
  } finally {
    db.raw.close();
  }
});
void test('staff review and retry cannot restore an expired or previously redacted response', async () => {
  const { db, s } = await fixture();
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='staff'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('staff','staff',?)",
      )
      .run(now.toISOString());
    const actor = await loadActor(db, 'staff');
    assert.ok(actor);
    await s.recordTaskInteraction(db, operation, now);
    db.raw.prepare("UPDATE task_checkin_operations SET state='retryable'").run();
    observe(db);
    const input = {
      sourceId: 'source',
      operationId: operation.id,
      expectedUpdatedAt: now.toISOString(),
    };
    assert.equal(
      (await taskCheckinReview(db, actor, 'source', { now })).operations.items[0]?.safe_retry,
      1,
    );
    assert.equal(
      (await taskCheckinReview(db, actor, 'source', { now: expired })).operations.items[0]
        ?.safe_retry,
      0,
    );
    assert.equal(await retryTaskCheckinOperation(db, actor, input, expired), false);
    await runMaintenance(db, { now: expired, category: 'records' });
    db.raw
      .prepare(
        "UPDATE task_checkin_sources SET policy_json=json_set(policy_json,'$.retentionDays',365)",
      )
      .run();
    assert.equal(await retryTaskCheckinOperation(db, actor, input, expired), false);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM staff_audits').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});
