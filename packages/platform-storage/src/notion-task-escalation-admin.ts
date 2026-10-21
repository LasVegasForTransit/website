import type { Db } from './db';
import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { TASK_ESCALATION_AUTHORITY_SQL as ELIGIBLE } from './notion-task-escalation-authority';
import { auditedTaskCheckinChange } from './notion-task-admin-audit';
export interface EscalationReviewRow {
  id: string;
  task_id: string;
  recipient_notion_id: string | null;
  state: string;
  reason: string | null;
  trigger_kind: string;
  task_title: string | null;
  subject_name: string | null;
  recipient_name: string | null;
  updated_at: string;
  safe_retry: number;
}
export async function taskEscalationReview(db: Db, actor: Actor, sourceId: string, cursor = '') {
  if (!(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actor.personId).first()))
    throw new PermissionDenied('staff_admin.manage');
  const rows = await db
    .prepare(
      `SELECT o.id,o.task_id,o.recipient_notion_id,o.state,o.reason,o.trigger_kind,o.updated_at,
    json_extract(t.snapshot_json,'$.title') AS task_title,
    nullif(trim(coalesce(subject.given_name,'')||' '||coalesce(subject.family_name,'')),'') AS subject_name,
    nullif(trim(coalesce(recipient.given_name,'')||' '||coalesce(recipient.family_name,'')),'') AS recipient_name,
    CASE WHEN o.state IN ('failed','retryable','review') AND ${ELIGIBLE} THEN 1 ELSE 0 END AS safe_retry
    FROM task_checkin_escalations o JOIN task_checkin_tasks t ON t.source_id=o.source_id AND t.task_id=o.task_id
    JOIN people subject ON subject.id=o.subject_id LEFT JOIN people recipient ON recipient.id=o.person_id
    WHERE o.source_id=? AND o.id>? AND o.state IN ('review','failed','retryable','held') AND ${STAFF_ADMIN_SCOPE}
    ORDER BY o.id LIMIT 51`,
    )
    .bind(sourceId, cursor, actor.personId)
    .all<EscalationReviewRow>();
  const items = rows.results.slice(0, 50);
  return { items, nextCursor: rows.results.length > 50 ? (items.at(-1)?.id ?? null) : null };
}
export function resolveTaskEscalation(
  db: Db,
  actor: Actor,
  input: {
    sourceId: string;
    operationId: string;
    expectedUpdatedAt: string;
    action: 'retry' | 'close';
  },
  now: Date,
): Promise<boolean> {
  const retry = input.action === 'retry';
  const mutation = db
    .prepare(
      `UPDATE task_checkin_escalations AS o SET state=?,attempts=CASE WHEN ?=1 THEN 0 ELSE attempts END,
    reason=?,claim_token=NULL,lease_expires_at=NULL,next_attempt_at=?,updated_at=?
    WHERE id=? AND source_id=? AND updated_at=? AND ${STAFF_ADMIN_SCOPE}
      AND ${retry ? `state IN ('failed','retryable','review') AND ${ELIGIBLE}` : "state IN ('review','failed','retryable','held')"}`,
    )
    .bind(
      retry ? 'queued' : 'closed',
      Number(retry),
      retry ? null : 'staff_closed',
      now.toISOString(),
      now.toISOString(),
      input.operationId,
      input.sourceId,
      input.expectedUpdatedAt,
      actor.personId,
    );
  return auditedTaskCheckinChange(db, actor, {
    mutation,
    action: `task_checkins.escalation_${input.action}`,
    targetId: input.operationId,
    now,
  });
}
