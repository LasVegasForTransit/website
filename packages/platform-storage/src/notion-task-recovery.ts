import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditedTaskCheckinChange } from './notion-task-admin-audit';
import type { TaskOperation } from './notion-task-operations';
interface RecoveryInput {
  sourceId: string;
  operationId: string;
  expectedUpdatedAt: string;
}
export interface TaskCommentRecovery extends TaskOperation {
  recovery_actor_id: string;
  recovery_token: string;
  recovery_expected_at: string;
  recovery_attempts: number;
}
const ADMIN = STAFF_ADMIN_SCOPE.replace('?', 'r.actor_id');
const VALID = `o.state='held' AND o.reason='unconfirmed_effect' AND o.kind IN ('progress','blocker','extension')
  AND o.updated_at=r.expected_updated_at AND p.deleted_at IS NULL AND ${ADMIN}`;
export function requestTaskCommentRecovery(db: Db, actor: Actor, input: RecoveryInput, now: Date) {
  const mutation = db
    .prepare(
      `INSERT INTO task_checkin_recovery(operation_id,actor_id,expected_updated_at,next_attempt_at,updated_at)
    SELECT o.id,?,o.updated_at,?,? FROM task_checkin_operations o JOIN people p ON p.id=o.person_id
    WHERE o.id=? AND o.source_id=? AND o.updated_at=? AND o.state='held' AND o.reason='unconfirmed_effect'
    AND o.kind IN ('progress','blocker','extension') AND p.deleted_at IS NULL AND ${STAFF_ADMIN_SCOPE}
    ON CONFLICT(operation_id) DO UPDATE SET actor_id=excluded.actor_id,expected_updated_at=excluded.expected_updated_at,
      state='queued',attempts=0,claim_token=NULL,lease_expires_at=NULL,reason=NULL,next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at
    WHERE task_checkin_recovery.state IN ('checked','failed','superseded')`,
    )
    .bind(
      actor.personId,
      now.toISOString(),
      now.toISOString(),
      input.operationId,
      input.sourceId,
      input.expectedUpdatedAt,
      actor.personId,
    );
  return auditedTaskCheckinChange(db, actor, {
    mutation,
    action: 'task_checkins.reconcile_requested',
    targetId: input.operationId,
    now,
  });
}
export function closeHeldTaskUpdate(db: Db, actor: Actor, input: RecoveryInput, now: Date) {
  const mutation = db
    .prepare(
      `UPDATE task_checkin_operations SET state='superseded',reason='staff_closed',updated_at=?
    WHERE id=? AND source_id=? AND updated_at=? AND state='held' AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(
      now.toISOString(),
      input.operationId,
      input.sourceId,
      input.expectedUpdatedAt,
      actor.personId,
    );
  return auditedTaskCheckinChange(db, actor, {
    mutation,
    action: 'task_checkins.close_unconfirmed',
    targetId: input.operationId,
    now,
    after: (auditId) => [
      db
        .prepare(
          `UPDATE task_checkin_recovery SET state='superseded',reason='staff_closed',claim_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE operation_id=? AND EXISTS(SELECT 1 FROM staff_audits WHERE id=?)`,
        )
        .bind(now.toISOString(), input.operationId, auditId),
    ],
  });
}
export async function claimTaskCommentRecovery(
  db: Db,
  sourceId: string,
  now: Date,
): Promise<TaskCommentRecovery | null> {
  const stamp = now.toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE task_checkin_recovery SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,
      claim_token=NULL,lease_expires_at=NULL,reason='check_interrupted',next_attempt_at=?,updated_at=?
      WHERE state='processing' AND lease_expires_at<=? AND operation_id IN(SELECT id FROM task_checkin_operations WHERE source_id=?)`,
      )
      .bind(stamp, stamp, stamp, sourceId),
    db
      .prepare(
        `UPDATE task_checkin_recovery AS r SET state='superseded',reason='authority_changed',claim_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE state IN ('queued','processing') AND operation_id IN(SELECT id FROM task_checkin_operations WHERE source_id=?)
      AND NOT EXISTS(SELECT 1 FROM task_checkin_operations o JOIN people p ON p.id=o.person_id WHERE o.id=r.operation_id AND ${VALID})`,
      )
      .bind(stamp, sourceId),
  ]);
  const lease = await db
    .prepare(
      `UPDATE task_checkin_recovery SET state='processing',attempts=attempts+1,claim_token=?,lease_expires_at=?,updated_at=?
    WHERE operation_id=(SELECT r.operation_id FROM task_checkin_recovery r JOIN task_checkin_operations o ON o.id=r.operation_id
      JOIN people p ON p.id=o.person_id WHERE o.source_id=? AND r.state='queued' AND r.attempts<3 AND r.next_attempt_at<=?
      AND ${VALID} ORDER BY r.updated_at,r.operation_id LIMIT 1) AND state='queued' RETURNING operation_id,claim_token`,
    )
    .bind(randomToken(), new Date(now.getTime() + 90_000).toISOString(), stamp, sourceId, stamp)
    .first<{ operation_id: string; claim_token: string }>();
  return lease
    ? db
        .prepare(
          `SELECT o.*,r.actor_id AS recovery_actor_id,r.claim_token AS recovery_token,r.expected_updated_at AS recovery_expected_at,r.attempts AS recovery_attempts
    FROM task_checkin_recovery r JOIN task_checkin_operations o ON o.id=r.operation_id JOIN people p ON p.id=o.person_id
    WHERE r.operation_id=? AND r.claim_token=? AND r.state='processing' AND r.lease_expires_at>? AND ${VALID}`,
        )
        .bind(lease.operation_id, lease.claim_token, stamp)
        .first<TaskCommentRecovery>()
    : null;
}
export async function finishTaskCommentRecovery(
  db: Db,
  claim: TaskCommentRecovery,
  commentId: string | null,
  now: Date,
): Promise<boolean> {
  const stamp = now.toISOString();
  if (!commentId) {
    const result = await db
      .prepare(
        `UPDATE task_checkin_recovery AS r SET state='checked',reason='not_confirmed',claim_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE operation_id=? AND state='processing' AND claim_token=? AND lease_expires_at>?
      AND EXISTS(SELECT 1 FROM task_checkin_operations o JOIN people p ON p.id=o.person_id WHERE o.id=r.operation_id AND ${VALID})`,
      )
      .bind(stamp, claim.id, claim.recovery_token, stamp)
      .run();
    return result.meta.changes > 0;
  }
  const mutation = db
    .prepare(
      `UPDATE task_checkin_operations AS o SET state='confirmed',reason=NULL,result_json=?,updated_at=?
    WHERE id=? AND EXISTS(SELECT 1 FROM task_checkin_recovery r JOIN people p ON p.id=o.person_id
      WHERE r.operation_id=o.id AND r.state='processing' AND r.claim_token=? AND r.lease_expires_at>? AND ${VALID})`,
    )
    .bind(JSON.stringify({ commentId }), stamp, claim.id, claim.recovery_token, stamp);
  return auditedTaskCheckinChange(
    db,
    { personId: claim.recovery_actor_id },
    {
      mutation,
      action: 'task_checkins.reconciled',
      targetId: claim.id,
      now,
      after: (auditId) => [
        db
          .prepare(
            `UPDATE task_checkin_recovery SET state='checked',reason='confirmed',claim_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE operation_id=? AND claim_token=? AND EXISTS(SELECT 1 FROM staff_audits WHERE id=?)`,
          )
          .bind(stamp, claim.id, claim.recovery_token, auditId),
      ],
    },
  );
}
export async function failTaskCommentRecovery(
  db: Db,
  claim: TaskCommentRecovery,
  now: Date,
  options: { retryAfterMs?: number; terminal?: boolean } = {},
): Promise<void> {
  const providerDelay =
    typeof options.retryAfterMs === 'number' && Number.isFinite(options.retryAfterMs)
      ? options.retryAfterMs
      : 0;
  const delay = Math.max(
    60_000 * claim.recovery_attempts,
    Math.min(86_400_000, Math.max(0, providerDelay)),
  );
  await db
    .prepare(
      `UPDATE task_checkin_recovery SET state=CASE WHEN ?=1 OR attempts>=3 THEN 'failed' ELSE 'queued' END,
    claim_token=NULL,lease_expires_at=NULL,reason='provider_unavailable',next_attempt_at=?,updated_at=?
    WHERE operation_id=? AND state='processing' AND claim_token=? AND lease_expires_at>?`,
    )
    .bind(
      Number(options.terminal === true),
      new Date(now.getTime() + delay).toISOString(),
      now.toISOString(),
      claim.id,
      claim.recovery_token,
      now.toISOString(),
    )
    .run();
}
