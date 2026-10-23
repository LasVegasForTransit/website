import type { Db } from './db';
import type { TaskOperation } from './notion-task-operations';
import { TASK_CHECKIN_AUTHORITY_SQL as ELIGIBLE } from './notion-task-authority';
export interface TaskReminderCandidate {
  source_id: string;
  task_id: string;
  person_id: string;
  task_revision: string;
  consent_revision: number;
  policy_revision: number;
  snapshot_json: string;
  snoozed_until: string | null;
  last_delivery_json: string | null;
  last_response_at: string | null;
}
function limitSize(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new Error('Invalid task batch size');
  return limit;
}
export async function listTaskReminderCandidates(
  db: Db,
  sourceId: string,
  limit: number,
  target?: { taskId?: string; personId?: string; policyKey?: string },
): Promise<TaskReminderCandidate[]> {
  const result = await db
    .prepare(
      `WITH o AS (SELECT s.id AS source_id,t.task_id,c.person_id,t.revision AS task_revision,
    c.revision AS consent_revision,s.revision AS policy_revision,t.snapshot_json
    FROM task_checkin_sources s JOIN task_checkin_tasks t ON t.source_id=s.id
    JOIN task_checkin_consents c ON c.source_id=s.id WHERE s.id=?)
    SELECT o.*,card.snoozed_until,
    (SELECT json_object('id',d.id,'at',d.updated_at,'scheduledAt',json_extract(d.payload_json,'$.scheduledAt'))
      FROM task_checkin_operations d WHERE d.source_id=o.source_id AND d.task_id=o.task_id AND d.person_id=o.person_id
      AND d.task_revision=o.task_revision
      AND ((? IS NULL AND d.consent_revision=o.consent_revision AND d.policy_revision=o.policy_revision)
        OR json_extract(d.payload_json,'$.policyKey')=?)
      AND d.kind='delivery' AND d.state='confirmed' AND json_extract(d.payload_json,'$.kind') IN ('pre_deadline','overdue')
      ORDER BY d.updated_at DESC,d.id DESC LIMIT 1) AS last_delivery_json,
    (SELECT MAX(r.created_at) FROM task_checkin_operations r WHERE r.source_id=o.source_id AND r.task_id=o.task_id
      AND r.person_id=o.person_id AND r.kind<>'delivery' AND r.state='confirmed') AS last_response_at
    FROM o LEFT JOIN task_checkin_cards card ON card.source_id=o.source_id AND card.task_id=o.task_id AND card.person_id=o.person_id
    WHERE ${ELIGIBLE} AND (? IS NULL OR (o.task_id=? AND o.person_id=?)) ORDER BY COALESCE(card.last_evaluated_at,''),o.task_id,o.person_id LIMIT ?`,
    )
    .bind(
      sourceId,
      target?.policyKey ?? null,
      target?.policyKey ?? null,
      target?.taskId ?? null,
      target?.taskId ?? null,
      target?.personId ?? null,
      limitSize(limit),
    )
    .all<TaskReminderCandidate>();
  return result.results;
}
export async function noteTaskReminderEvaluation(
  db: Db,
  input: { sourceId: string; taskId: string; personId: string },
  now: Date,
): Promise<void> {
  await db
    .prepare(
      'UPDATE task_checkin_cards SET last_evaluated_at=? WHERE source_id=? AND task_id=? AND person_id=?',
    )
    .bind(now.toISOString(), input.sourceId, input.taskId, input.personId)
    .run();
}
export async function listTaskOperationQueue(
  db: Db,
  sourceId: string,
  now: Date,
  options: number | { limit: number; includeDeliveries: boolean },
): Promise<{ id: string; kind: TaskOperation['kind'] }[]> {
  const limit = typeof options === 'number' ? options : options.limit;
  const includeDeliveries = typeof options === 'number' || options.includeDeliveries;
  const result = await db
    .prepare(
      `SELECT id,kind FROM task_checkin_operations WHERE source_id=? AND (?=1 OR kind<>'delivery')
    AND ((state IN ('queued','retryable') AND next_attempt_at<=?) OR (state='processing' AND lease_expires_at<=?))
    ORDER BY CASE WHEN kind='delivery' THEN 1 ELSE 0 END,created_at,id LIMIT ?`,
    )
    .bind(
      sourceId,
      Number(includeDeliveries),
      now.toISOString(),
      now.toISOString(),
      limitSize(limit),
    )
    .all<{ id: string; kind: TaskOperation['kind'] }>();
  return result.results;
}
/** Both receipt and card reference are saved in one transaction with the current authority fence. */
export async function confirmTaskDelivery(
  db: Db,
  operation: TaskOperation,
  destination: { channelId: string; messageId: string },
  now: Date,
): Promise<boolean> {
  const result = JSON.stringify(destination),
    stamp = now.toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE task_checkin_operations AS o SET state='confirmed',result_json=?,claim_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE id=? AND kind='delivery' AND state='processing' AND claim_token=? AND lease_expires_at>? AND ${ELIGIBLE}
      AND EXISTS(SELECT 1 FROM task_checkin_cards card WHERE card.source_id=o.source_id AND card.task_id=o.task_id AND card.person_id=o.person_id)`,
      )
      .bind(result, stamp, operation.id, operation.claim_token, stamp),
    db
      .prepare(
        `UPDATE task_checkin_cards SET channel_id=?,message_id=?,updated_at=? WHERE source_id=? AND task_id=? AND person_id=?
      AND EXISTS(SELECT 1 FROM task_checkin_operations o WHERE o.id=? AND o.state='confirmed' AND o.result_json=? AND o.updated_at=?)`,
      )
      .bind(
        destination.channelId,
        destination.messageId,
        stamp,
        operation.source_id,
        operation.task_id,
        operation.person_id,
        operation.id,
        result,
        stamp,
      ),
  ]);
  return Boolean(
    await db
      .prepare(
        "SELECT 1 FROM task_checkin_operations WHERE id=? AND state='confirmed' AND result_json=?",
      )
      .bind(operation.id, result)
      .first(),
  );
}

export async function deferTaskDelivery(
  db: Db,
  operation: TaskOperation,
  now: Date,
): Promise<void> {
  await db
    .prepare(
      `UPDATE task_checkin_operations AS o SET state='queued',attempts=attempts-1,next_attempt_at=?,reason='notification_deferred',claim_token=NULL,lease_expires_at=NULL,updated_at=?
    WHERE id=? AND kind='delivery' AND state='processing' AND claim_token=? AND lease_expires_at>? AND ${ELIGIBLE}`,
    )
    .bind(
      new Date(now.getTime() + 60_000).toISOString(),
      now.toISOString(),
      operation.id,
      operation.claim_token,
      now.toISOString(),
    )
    .run();
}
