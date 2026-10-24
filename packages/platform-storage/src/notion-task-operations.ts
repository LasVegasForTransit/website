import { taskMappingMatches } from './notion-task-person-lineage';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from './db';
import { TASK_CHECKIN_AUTHORITY_SQL as ELIGIBLE } from './notion-task-authority';
import { TASK_OPERATION_RETAINED_SQL as RETAINED } from './notion-task-operation-retention';

export interface TaskOperationInput {
  id: string;
  sourceId: string;
  taskId: string;
  personId: string;
  taskRevision: string;
  consentRevision: number;
  policyRevision: number;
  kind: 'delivery' | 'progress' | 'blocker' | 'complete' | 'extension' | 'snooze';
  payload: Record<string, unknown>;
}
export interface TaskOperation {
  id: string;
  source_id: string;
  task_id: string;
  person_id: string;
  task_revision: string;
  consent_revision: number;
  policy_revision: number;
  kind: TaskOperationInput['kind'];
  payload_json: string;
  state: string;
  attempts: number;
  claim_token: string;
  lease_expires_at: string;
}

/** Both enqueue and claim recheck the same current authority, not only receipt history. */

export async function recordTaskInteraction(
  db: Db,
  input: TaskOperationInput,
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare(
      `WITH o(id,source_id,task_id,person_id,task_revision,consent_revision,policy_revision,kind,payload_json) AS
    (VALUES(?,?,?,?,?,?,?,?,?))
    INSERT OR IGNORE INTO task_checkin_operations
    (id,source_id,task_id,person_id,task_revision,consent_revision,policy_revision,kind,payload_json,next_attempt_at,created_at,updated_at)
    SELECT o.*,?,?,? FROM o WHERE ${ELIGIBLE}
    AND (o.kind='delivery' OR (SELECT count(*) FROM task_checkin_operations recent
      WHERE recent.source_id=o.source_id AND recent.person_id=o.person_id AND recent.kind<>'delivery'
      AND recent.created_at>=?)<5)`,
    )
    .bind(
      input.id,
      input.sourceId,
      input.taskId,
      input.personId,
      input.taskRevision,
      input.consentRevision,
      input.policyRevision,
      input.kind,
      JSON.stringify(input.payload),
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
      new Date(now.getTime() - 60_000).toISOString(),
    )
    .run();
  return result.meta.changes > 0;
}
export function enqueueTaskDelivery(
  db: Db,
  input: Omit<TaskOperationInput, 'kind'>,
  now: Date,
): Promise<boolean> {
  return recordTaskInteraction(db, { ...input, kind: 'delivery' }, now);
}

export async function claimTaskOperation(
  db: Db,
  id: string,
  now: Date,
): Promise<TaskOperation | null> {
  const stamp = now.toISOString();
  await db
    .prepare(
      `UPDATE task_checkin_operations SET state='held',reason='unconfirmed_effect',updated_at=?
    WHERE id=? AND state='processing' AND lease_expires_at<=?`,
    )
    .bind(stamp, id, stamp)
    .run();
  await db
    .prepare(
      `UPDATE task_checkin_operations AS o SET
      state=CASE WHEN NOT ${ELIGIBLE} THEN 'superseded' ELSE 'failed' END,
      reason=CASE WHEN NOT ${ELIGIBLE} THEN 'authority_changed' WHEN attempts>=5 THEN 'retry_limit' ELSE 'retention_expired' END,
      updated_at=? WHERE id=? AND state IN ('queued','retryable')
      AND (NOT ${ELIGIBLE} OR attempts>=5 OR NOT ${RETAINED})`,
    )
    .bind(stamp, id, stamp)
    .run();
  return db
    .prepare(
      `UPDATE task_checkin_operations AS o SET state='processing',claim_token=?,
    lease_expires_at=?,attempts=attempts+1,updated_at=?
    WHERE id=? AND state IN ('queued','retryable') AND attempts<5 AND next_attempt_at<=? AND ${ELIGIBLE} AND ${RETAINED}
    RETURNING *`,
    )
    .bind(randomToken(), new Date(now.getTime() + 60_000).toISOString(), stamp, id, stamp, stamp)
    .first<TaskOperation>();
}

interface OperationOutcome {
  state: 'confirmed' | 'retryable' | 'held' | 'failed' | 'superseded';
  reason?: string;
  result?: Record<string, unknown>;
  retryAfterMs?: number;
}
export async function completeTaskOperation(
  db: Db,
  lease: { id: string; token: string },
  outcome: OperationOutcome,
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE task_checkin_operations SET state=CASE WHEN ?='retryable' AND attempts>=5 THEN 'failed' ELSE ? END,reason=?,result_json=?,
    next_attempt_at=?,claim_token=NULL,lease_expires_at=NULL,updated_at=?
    WHERE id=? AND claim_token=? AND state='processing' AND lease_expires_at>?`,
    )
    .bind(
      outcome.state,
      outcome.state,
      outcome.reason ?? null,
      outcome.result ? JSON.stringify(outcome.result) : null,
      new Date(now.getTime() + Math.max(1000, outcome.retryAfterMs ?? 60_000)).toISOString(),
      now.toISOString(),
      lease.id,
      lease.token,
      now.toISOString(),
    )
    .run();
  return result.meta.changes > 0;
}

export interface TaskActionContext {
  policy_json: string;
  snapshot_json: string;
  source_edited_at: string;
  notion_user_id: string;
  discord_user_id: string;
}
/** Recheck after provider reads as policy or consent may have changed while awaiting HTTP. */
export function readTaskActionContext(
  db: Db,
  operation: TaskOperation,
  now: Date,
): Promise<TaskActionContext | null> {
  return db
    .prepare(
      `SELECT s.policy_json,t.snapshot_json,t.source_edited_at,m.notion_user_id,c.discord_user_id
    FROM task_checkin_operations o
    JOIN task_checkin_sources s ON s.id=o.source_id
    JOIN task_checkin_tasks t ON t.source_id=o.source_id AND t.task_id=o.task_id
    JOIN task_checkin_mappings m ON m.workspace_id=s.workspace_id AND ${taskMappingMatches('m', 'o.person_id')}
    JOIN task_checkin_consents c ON c.source_id=o.source_id AND c.person_id=o.person_id
    WHERE o.id=? AND o.claim_token=? AND o.state='processing' AND o.lease_expires_at>? AND ${ELIGIBLE} AND ${RETAINED}`,
    )
    .bind(operation.id, operation.claim_token, now.toISOString(), now.toISOString())
    .first<TaskActionContext>();
}
export async function confirmTaskSnooze(
  db: Db,
  operation: TaskOperation,
  minutes: number,
  now: Date,
): Promise<boolean> {
  const stamp = now.toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE task_checkin_cards SET snoozed_until=?,updated_at=?
      WHERE source_id=? AND task_id=? AND person_id=? AND EXISTS(SELECT 1 FROM task_checkin_operations o
      WHERE o.id=? AND o.kind='snooze' AND o.state='processing' AND o.claim_token=? AND o.lease_expires_at>? AND ${ELIGIBLE} AND ${RETAINED})`,
      )
      .bind(
        new Date(now.getTime() + minutes * 60_000).toISOString(),
        stamp,
        operation.source_id,
        operation.task_id,
        operation.person_id,
        operation.id,
        operation.claim_token,
        stamp,
        stamp,
      ),
    db
      .prepare(
        `UPDATE task_checkin_operations AS o SET state='confirmed',claim_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE id=? AND kind='snooze' AND state='processing' AND claim_token=? AND lease_expires_at>? AND ${ELIGIBLE} AND ${RETAINED}
      AND EXISTS(SELECT 1 FROM task_checkin_cards card WHERE card.source_id=o.source_id AND card.task_id=o.task_id AND card.person_id=o.person_id AND card.updated_at=?)`,
      )
      .bind(stamp, operation.id, operation.claim_token, stamp, stamp, stamp),
  ]);
  return Boolean(
    await db
      .prepare("SELECT 1 FROM task_checkin_operations WHERE id=? AND state='confirmed'")
      .bind(operation.id)
      .first(),
  );
}
export function readHeldTaskComment(db: Db, id: string): Promise<TaskOperation | null> {
  return db
    .prepare(
      `SELECT o.* FROM task_checkin_operations o
    WHERE id=? AND state='held' AND reason='unconfirmed_effect' AND kind IN ('progress','blocker','extension')
    AND EXISTS(SELECT 1 FROM people p WHERE p.id=o.person_id AND p.deleted_at IS NULL)`,
    )
    .bind(id)
    .first<TaskOperation>();
}
export async function confirmHeldTaskComment(
  db: Db,
  id: string,
  commentId: string,
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE task_checkin_operations SET state='confirmed',reason=NULL,result_json=?,updated_at=?
    WHERE id=? AND state='held' AND reason='unconfirmed_effect' AND kind IN ('progress','blocker','extension')`,
    )
    .bind(JSON.stringify({ commentId }), now.toISOString(), id)
    .run();
  return result.meta.changes > 0;
}
