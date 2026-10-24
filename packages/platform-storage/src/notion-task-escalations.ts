import { taskMappingMatches } from './notion-task-person-lineage';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from './db';
import {
  TASK_ESCALATION_AUTHORITY_SQL as ELIGIBLE,
  TASK_ESCALATION_SUBJECT_SQL as SUBJECT,
  TASK_ESCALATION_RETAINED_SQL as RETAINED,
} from './notion-task-escalation-authority';
export interface EscalationRecipient {
  key: string;
  personId: string | null;
  notionId: string | null;
  reviewReason?: 'routing_provider_unavailable' | 'routing_limit';
  retryAfterMs?: number;
}
export interface TaskEscalation {
  id: string;
  source_id: string;
  task_id: string;
  subject_id: string;
  person_id: string;
  recipient_notion_id: string | null;
  trigger_kind: 'blocker' | 'overdue';
  blocker_id: string | null;
  task_revision: string;
  consent_revision: number;
  recipient_consent_revision: number;
  policy_revision: number;
  claim_token: string;
  attempts: number;
}
export interface EscalationInput {
  eventKey: string;
  sourceId: string;
  taskId: string;
  subjectId: string;
  taskRevision: string;
  consentRevision: number;
  policyRevision: number;
  trigger: 'blocker' | 'overdue';
  blockerId: string | null;
  recipients: EscalationRecipient[];
}
function routingRecipients(recipients: EscalationRecipient[], now: Date): string {
  return JSON.stringify(
    recipients.map((recipient) => ({
      ...recipient,
      retryAt: recipient.reviewReason
        ? new Date(
            now.getTime() +
              Math.max(60_000, Math.min(86_400_000, recipient.retryAfterMs ?? 60_000)),
          ).toISOString()
        : now.toISOString(),
    })),
  );
}
export async function queueTaskEscalation(
  db: Db,
  input: EscalationInput,
  now: Date,
): Promise<void> {
  const stamp = now.toISOString(),
    recipients = routingRecipients(input.recipients, now);
  await db.batch([
    db
      .prepare(
        `UPDATE task_checkin_escalations AS o SET state='superseded',reason='routing_changed',updated_at=?
      WHERE event_key=? AND state='review' AND ${SUBJECT}
      AND NOT EXISTS(SELECT 1 FROM json_each(?) r WHERE json_extract(r.value,'$.key')=o.recipient_key)`,
      )
      .bind(stamp, input.eventKey, recipients),
    db
      .prepare(
        `WITH o AS (SELECT ? AS source_id,? AS task_id,? AS subject_id,? AS task_revision,
      ? AS consent_revision,? AS policy_revision,? AS trigger_kind,? AS blocker_id,
      json_extract(r.value,'$.key') AS recipient_key,
      (SELECT p.id FROM people p WHERE p.id=json_extract(r.value,'$.personId') AND p.deleted_at IS NULL) AS person_id,
      json_extract(r.value,'$.notionId') AS recipient_notion_id,
      json_extract(r.value,'$.reviewReason') AS routing_reason,json_extract(r.value,'$.retryAt') AS routing_retry_at,
      (SELECT c.revision FROM task_checkin_consents c WHERE c.source_id=? AND c.person_id=json_extract(r.value,'$.personId')) AS recipient_consent_revision
      FROM json_each(?) r)
      INSERT INTO task_checkin_escalations(id,event_key,recipient_key,source_id,task_id,subject_id,person_id,recipient_notion_id,
        task_revision,consent_revision,policy_revision,recipient_consent_revision,trigger_kind,blocker_id,state,reason,next_attempt_at,created_at,updated_at)
      SELECT ?||':'||o.recipient_key,?,o.recipient_key,o.source_id,o.task_id,o.subject_id,o.person_id,o.recipient_notion_id,
        o.task_revision,o.consent_revision,o.policy_revision,o.recipient_consent_revision,o.trigger_kind,o.blocker_id,
        CASE WHEN ${ELIGIBLE} THEN 'queued' ELSE 'review' END,
        CASE WHEN ${ELIGIBLE} THEN NULL ELSE coalesce(o.routing_reason,'recipient_unavailable') END,coalesce(o.routing_retry_at,?),?,? FROM o WHERE ${SUBJECT}
        AND (o.blocker_id IS NULL OR EXISTS(SELECT 1 FROM task_checkin_operations b WHERE b.id=o.blocker_id AND b.state='confirmed' AND b.history_cleared_at IS NULL))
      ON CONFLICT(event_key,recipient_key) DO UPDATE SET person_id=excluded.person_id,recipient_notion_id=excluded.recipient_notion_id,
        recipient_consent_revision=excluded.recipient_consent_revision,task_revision=excluded.task_revision,
        consent_revision=excluded.consent_revision,policy_revision=excluded.policy_revision,
        state=excluded.state,reason=excluded.reason,updated_at=excluded.updated_at,
        next_attempt_at=CASE WHEN excluded.state='review' THEN excluded.next_attempt_at ELSE task_checkin_escalations.next_attempt_at END
      WHERE task_checkin_escalations.state IN ('queued','retryable','review')
        AND (task_checkin_escalations.task_revision<>excluded.task_revision
        OR task_checkin_escalations.consent_revision<>excluded.consent_revision
        OR task_checkin_escalations.policy_revision<>excluded.policy_revision
        OR (task_checkin_escalations.state='review' AND excluded.state<>'review')
        OR task_checkin_escalations.person_id IS NOT excluded.person_id
        OR task_checkin_escalations.recipient_consent_revision IS NOT excluded.recipient_consent_revision
        OR (task_checkin_escalations.state='review' AND task_checkin_escalations.reason IS NOT excluded.reason)
        OR (task_checkin_escalations.state='review' AND excluded.reason IN ('routing_provider_unavailable','routing_limit')
          AND task_checkin_escalations.next_attempt_at<=excluded.created_at))`,
      )
      .bind(
        input.sourceId,
        input.taskId,
        input.subjectId,
        input.taskRevision,
        input.consentRevision,
        input.policyRevision,
        input.trigger,
        input.blockerId,
        input.sourceId,
        recipients,
        input.eventKey,
        input.eventKey,
        stamp,
        stamp,
        stamp,
      ),
  ]);
}
export async function claimTaskEscalation(
  db: Db,
  sourceId: string,
  now: Date,
): Promise<TaskEscalation | null> {
  const stamp = now.toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE task_checkin_escalations SET state='held',reason='unconfirmed_effect',claim_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE source_id=? AND state='processing' AND lease_expires_at<=?`,
      )
      .bind(stamp, sourceId, stamp),
    db
      .prepare(
        `UPDATE task_checkin_escalations AS o SET state=CASE WHEN ${SUBJECT} THEN 'review' ELSE 'superseded' END,
      reason='authority_changed',updated_at=? WHERE source_id=? AND state IN ('queued','retryable') AND NOT(${ELIGIBLE} AND ${RETAINED})`,
      )
      .bind(stamp, sourceId, stamp),
  ]);
  return db
    .prepare(
      `UPDATE task_checkin_escalations AS o SET state='processing',claim_token=?,lease_expires_at=?,attempts=attempts+1,updated_at=?
    WHERE id=(SELECT o.id FROM task_checkin_escalations o WHERE source_id=? AND state IN ('queued','retryable')
      AND next_attempt_at<=? AND attempts<5 AND ${ELIGIBLE} AND ${RETAINED}
      ORDER BY CASE WHEN trigger_kind='blocker' THEN 0 ELSE 1 END,created_at,id LIMIT 1)
    AND state IN ('queued','retryable') RETURNING *`,
    )
    .bind(
      randomToken(),
      new Date(now.getTime() + 60_000).toISOString(),
      stamp,
      sourceId,
      stamp,
      stamp,
    )
    .first<TaskEscalation>();
}
export interface TaskEscalationContext {
  snapshot_json: string;
  source_edited_at: string;
  policy_json: string;
  notion_user_id: string;
  discord_user_id: string;
  subject_discord_user_id: string;
  subject_name: string | null;
  blocker_text: string | null;
  snoozed_until: string | null;
}
export function readTaskEscalationContext(
  db: Db,
  claim: TaskEscalation,
  now: Date,
): Promise<TaskEscalationContext | null> {
  return db
    .prepare(
      `SELECT t.snapshot_json,t.source_edited_at,s.policy_json,m.notion_user_id,c.discord_user_id,
    subject.discord_user_id AS subject_discord_user_id,
    nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),'') AS subject_name,
    json_extract(b.payload_json,'$.text') AS blocker_text,card.snoozed_until
    FROM task_checkin_escalations o JOIN task_checkin_sources s ON s.id=o.source_id
    JOIN task_checkin_tasks t ON t.source_id=o.source_id AND t.task_id=o.task_id
    JOIN task_checkin_mappings m ON m.workspace_id=s.workspace_id AND ${taskMappingMatches('m', 'o.subject_id')}
    JOIN task_checkin_consents c ON c.source_id=o.source_id AND c.person_id=o.person_id
    JOIN task_checkin_consents subject ON subject.source_id=o.source_id AND subject.person_id=o.subject_id
    JOIN people p ON p.id=o.subject_id LEFT JOIN task_checkin_operations b ON b.id=o.blocker_id
    LEFT JOIN task_checkin_cards card ON card.source_id=o.source_id AND card.task_id=o.task_id AND card.person_id=o.subject_id
    WHERE o.id=? AND o.state='processing' AND o.claim_token=? AND o.lease_expires_at>? AND ${ELIGIBLE} AND ${RETAINED}`,
    )
    .bind(claim.id, claim.claim_token, now.toISOString(), now.toISOString())
    .first<TaskEscalationContext>();
}
export async function settleTaskEscalation(
  db: Db,
  claim: TaskEscalation,
  outcome: {
    state: 'confirmed' | 'retryable' | 'held' | 'failed' | 'superseded' | 'review' | 'deferred';
    reason?: string;
    result?: Record<string, unknown>;
    retryAfterMs?: number;
  },
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE task_checkin_escalations AS o SET
    state=CASE WHEN ?='deferred' THEN 'queued' WHEN ?='retryable' AND attempts>=5 THEN 'failed' ELSE ? END,
    attempts=attempts-CASE WHEN ? IN ('deferred','review') THEN 1 ELSE 0 END,reason=?,result_json=?,next_attempt_at=?,claim_token=NULL,lease_expires_at=NULL,updated_at=?
    WHERE id=? AND state='processing' AND claim_token=? AND lease_expires_at>? AND (?<>'confirmed' OR ${ELIGIBLE})`,
    )
    .bind(
      outcome.state,
      outcome.state,
      outcome.state,
      outcome.state,
      outcome.reason ?? null,
      outcome.result ? JSON.stringify(outcome.result) : null,
      new Date(now.getTime() + Math.max(1000, outcome.retryAfterMs ?? 60_000)).toISOString(),
      now.toISOString(),
      claim.id,
      claim.claim_token,
      now.toISOString(),
      outcome.state,
    )
    .run();
  return result.meta.changes > 0;
}
