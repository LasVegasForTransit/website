import assert from 'node:assert/strict';
import test from 'node:test';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import { createSession } from '../src/auth';
import { collectPersonExport } from '../src/person-export';
import { queryBudget } from '../src/query-budget';
import { ensureTaskCard, attachTaskCardMessage } from '../src/notion-task-cards';
import { ready, now, operation } from './support/task-checkins';

void test('personal exports include task preferences and own responses without private routing or other task content', async () => {
  const { s, db } = await ready();
  try {
    const card = await ensureTaskCard(db, operation, now);
    assert.ok(card);
    await attachTaskCardMessage(
      db,
      { token: card.token, channelId: 'private-channel', messageId: 'private-message' },
      now,
    );
    await s.recordTaskInteraction(db, operation, now);
    db.raw
      .prepare(
        "UPDATE task_checkin_tasks SET snapshot_json=json_set(snapshot_json,'$.name','PRIVATE-NEW-ASSIGNEE-TITLE')",
      )
      .run();
    await s.putNotionTaskMapping(
      db,
      {
        workspaceId: 'workspace',
        notionUserId: 'PRIVATE-OTHER-USER',
        personId: 'guest',
        confirmedBy: 'staff',
      },
      now,
    );
    db.raw
      .prepare(
        `INSERT INTO task_checkin_digests(id,source_id,person_id,day,policy_revision,consent_revision,notion_user_id,next_attempt_at,created_at,updated_at)
      VALUES('digest','source','member','2026-10-20',1,1,'notion-member',?,?,?)`,
      )
      .run(now.toISOString(), now.toISOString(), now.toISOString());
    db.raw
      .prepare(
        `INSERT INTO task_checkin_operations(id,source_id,task_id,person_id,task_revision,consent_revision,policy_revision,kind,payload_json,next_attempt_at,created_at,updated_at)
      SELECT 'guest-response',source_id,task_id,'guest',task_revision,1,1,'progress','{"text":"PRIVATE-OTHER-RESPONSE"}',next_attempt_at,created_at,updated_at
      FROM task_checkin_operations WHERE id='operation'`,
      )
      .run();
    db.raw
      .prepare(
        "INSERT INTO task_checkin_notifications(kind,operation_id,source_id,person_id,reserved_at) VALUES('delivery','PRIVATE-NOTIFICATION-REFERENCE','source','member',?)",
      )
      .run(now.toISOString());
    db.raw
      .prepare(
        `INSERT INTO task_checkin_escalations(id,event_key,recipient_key,source_id,task_id,subject_id,person_id,
      task_revision,consent_revision,policy_revision,trigger_kind,state,next_attempt_at,created_at,updated_at)
      VALUES('PRIVATE-ESCALATION-REFERENCE','private-event','private-recipient','source','task','member','guest','v1',1,1,'overdue','review',?,?,?)`,
      )
      .run(now.toISOString(), now.toISOString(), now.toISOString());
    const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'export-fixture' };
    const session = await createSession(env, 'member', 'member', now);
    const authority = {
      kind: 'member' as const,
      personId: 'member',
      sessionHash: await hashWithSecret(env.LVBT_SIGN_IN_SECRET, `session:${session.token}`),
    };
    const budget = queryBudget(db, 50);
    const exported = await collectPersonExport(budget.db, 'member', authority, now);
    assert.ok(budget.queries <= 50);
    assert.ok(exported);
    assert.ok(Array.isArray(exported.activity));
    assert.deepEqual(exported.activity.map((event: Record<string, unknown>) => event.type).sort(), [
      'task_checkin_preference',
      'task_checkin_response',
    ]);
    assert.deepEqual(
      exported.activity.map((event: Record<string, unknown>) => event.description).sort(),
      ['Changed task check-in preferences', 'Responded to a task check-in'],
    );
    assert.equal(
      JSON.stringify(exported.task_checkin_mappings),
      JSON.stringify([
        {
          workspace_id: 'workspace',
          notion_user_id: 'notion-member',
          confirmed_at: now.toISOString(),
        },
      ]),
    );
    assert.match(JSON.stringify(exported.task_checkin_preferences), /active/);
    assert.match(JSON.stringify(exported.task_checkin_escalations), /reported/);
    assert.match(JSON.stringify(exported.task_checkin_notifications), /delivery/);
    assert.match(JSON.stringify(exported.task_checkin_consent_history), /active/);
    assert.match(JSON.stringify(exported.task_checkin_responses), /Draft ready/);
    assert.match(JSON.stringify(exported.task_checkin_cards), /task/);
    assert.match(JSON.stringify(exported.task_checkin_card_updates), /queued/);
    assert.match(JSON.stringify(exported.task_checkin_digests), /2026-10-20/);
    const serialized = JSON.stringify(exported);
    for (const forbidden of [
      card.token,
      'private-channel',
      'PRIVATE-NOTIFICATION-REFERENCE',
      'PRIVATE-ESCALATION-REFERENCE',
      'private-recipient',
      'private-message',
      'PRIVATE-NEW-ASSIGNEE-TITLE',
      'PRIVATE-OTHER-USER',
      'PRIVATE-OTHER-RESPONSE',
      'claim_token',
      'policy_json',
    ])
      assert.equal(serialized.includes(forbidden), false, forbidden);
    assert.equal(await collectPersonExport(db, 'guest', authority, now), null);
    db.raw.prepare('DELETE FROM sessions').run();
    assert.equal(await collectPersonExport(db, 'member', authority, now), null);
  } finally {
    db.raw.close();
  }
});
