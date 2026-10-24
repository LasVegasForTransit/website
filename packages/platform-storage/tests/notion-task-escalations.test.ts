import assert from 'node:assert/strict';
import test from 'node:test';
import { ready, now } from './support/task-checkins';

void test('escalation routing is durable, missing recipients require review and held effects cannot be requeued', async () => {
  const api = await import('../src/notion-task-escalations').catch(() => null);
  assert.ok(api, 'escalation queue must exist');
  const { db } = await ready();
  try {
    db.raw
      .prepare(
        `UPDATE task_checkin_sources SET policy_json=json_set(policy_json,
      '$.supportPersonIds',json('["member"]'),'$.escalation','support','$.escalationContentApproved',json('true'))`,
      )
      .run();
    const input = {
      eventKey: 'event',
      sourceId: 'source',
      taskId: 'task',
      subjectId: 'member',
      taskRevision: 'v1',
      consentRevision: 1,
      policyRevision: 1,
      trigger: 'overdue' as const,
      blockerId: null,
      recipients: [{ key: 'person:member', personId: 'member', notionId: null }],
    };
    await api.queueTaskEscalation(db, input, now);
    await api.queueTaskEscalation(db, input, now);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM task_checkin_escalations').get()?.n, 1);
    const claim = await api.claimTaskEscalation(db, 'source', now);
    assert.ok(claim);
    assert.ok(await api.readTaskEscalationContext(db, claim, now));
    assert.equal(
      await api.claimTaskEscalation(db, 'source', new Date(now.getTime() + 61_000)),
      null,
    );
    assert.equal(db.raw.prepare('SELECT state FROM task_checkin_escalations').get()?.state, 'held');
    await api.queueTaskEscalation(db, input, new Date(now.getTime() + 62_000));
    assert.equal(db.raw.prepare('SELECT state FROM task_checkin_escalations').get()?.state, 'held');
    await api.queueTaskEscalation(
      db,
      {
        ...input,
        eventKey: 'missing',
        recipients: [{ key: 'notion:unknown', personId: null, notionId: 'unknown' }],
      },
      now,
    );
    assert.equal(
      db.raw.prepare("SELECT state FROM task_checkin_escalations WHERE event_key='missing'").get()
        ?.state,
      'review',
    );
    db.raw
      .prepare('UPDATE people SET erased_at=?,deleted_at=? WHERE id=?')
      .run(now.toISOString(), now.toISOString(), 'member');
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM task_checkin_escalations').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});
void test('only a current administrator can close an uncertain escalation, with atomic audit and no retry', async () => {
  const api = await import('../src/notion-task-escalations');
  const admin = await import('../src/notion-task-escalation-admin');
  const { loadActor } = await import('../src/staff-roles');
  const { db } = await ready();
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='staff'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('staff','staff',?)",
      )
      .run(now.toISOString());
    db.raw
      .prepare(
        `UPDATE task_checkin_sources SET policy_json=json_set(policy_json,'$.supportPersonIds',json('["member"]'),'$.escalation','support','$.escalationContentApproved',json('true'))`,
      )
      .run();
    const actor = await loadActor(db, 'staff');
    assert.ok(actor);
    await api.queueTaskEscalation(
      db,
      {
        eventKey: 'audit',
        sourceId: 'source',
        taskId: 'task',
        subjectId: 'member',
        taskRevision: 'v1',
        consentRevision: 1,
        policyRevision: 1,
        trigger: 'overdue',
        blockerId: null,
        recipients: [{ key: 'person:member', personId: 'member', notionId: null }],
      },
      now,
    );
    const claim = await api.claimTaskEscalation(db, 'source', now);
    assert.ok(claim);
    const later = new Date(now.getTime() + 61_000);
    await api.claimTaskEscalation(db, 'source', later);
    const input = {
      sourceId: 'source',
      operationId: claim.id,
      expectedUpdatedAt: later.toISOString(),
    };
    assert.equal(
      await admin.resolveTaskEscalation(db, actor, { ...input, action: 'retry' }, later),
      false,
    );
    db.raw.exec(
      "CREATE TRIGGER fail_escalation_audit BEFORE INSERT ON staff_audits BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END",
    );
    await assert.rejects(
      admin.resolveTaskEscalation(db, actor, { ...input, action: 'close' }, later),
    );
    assert.equal(db.raw.prepare('SELECT state FROM task_checkin_escalations').get()?.state, 'held');
    db.raw.exec('DROP TRIGGER fail_escalation_audit');
    assert.equal(
      await admin.resolveTaskEscalation(
        db,
        actor,
        { ...input, expectedUpdatedAt: now.toISOString(), action: 'close' },
        later,
      ),
      false,
    );
    assert.equal(
      await admin.resolveTaskEscalation(db, actor, { ...input, action: 'close' }, later),
      true,
    );
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_escalations').get()?.state,
      'closed',
    );
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','staff',?)",
      )
      .run(now.toISOString());
    db.raw.prepare("DELETE FROM staff_administrators WHERE person_id='staff'").run();
    await assert.rejects(admin.taskEscalationReview(db, actor, 'source'));
  } finally {
    db.raw.close();
  }
});
