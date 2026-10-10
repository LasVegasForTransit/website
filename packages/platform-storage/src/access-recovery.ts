import type { Actor, MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import { can } from '@lasvegasfortransit/platform-core/permissions';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { loadActor } from './staff-roles';
import { auditDenied } from './audits';
import { CommitteeService, type AssignmentEndReason } from './committees';
export async function requestAccessRetry(
  db: Db,
  actor: Actor,
  operationId: string,
): Promise<MutationResult<{ personId: string; targetId: string }>> {
  const current = await loadActor(db, actor.personId);
  if (!current || !can(current, 'access.recover')) {
    await auditDenied(db, actor.personId, 'access.recover');
    return { kind: 'forbidden' };
  }
  if (!operationId.trim() || operationId.length > 200) return { kind: 'invalid' };
  const stamp = new Date().toISOString(),
    auditId = ulid();
  await db.batch([
    db
      .prepare(
        `UPDATE integration_outbox SET state='queued',next_attempt_at=?,updated_at=?,last_failure=NULL
      WHERE id=? AND state='retry' AND kind IN ('person_reconcile','committee_reconcile') AND ${STAFF_ADMIN_SCOPE}
      AND EXISTS(SELECT 1 FROM people p WHERE p.id=person_id AND p.deleted_at IS NULL)
      AND EXISTS(SELECT 1 FROM reconcile_generations g WHERE g.person_id=integration_outbox.person_id AND g.target_id=integration_outbox.target_id AND g.generation=integration_outbox.generation)`,
      )
      .bind(stamp, stamp, operationId, actor.personId),
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,occurred_at)
      SELECT ?,?,'access.retry',person_id,json_object('targetId',target_id),? FROM integration_outbox WHERE id=? AND changes()>0`,
      )
      .bind(auditId, actor.personId, stamp, operationId),
  ]);
  const row = await db
    .prepare(
      `SELECT target_id AS personId,json_extract(details,'$.targetId') AS targetId FROM staff_audits WHERE id=? AND action='access.retry' AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(auditId, actor.personId)
    .first<{ personId: string; targetId: string }>();
  return row ? { kind: 'ok', value: row } : { kind: 'conflict' };
}
export async function removeAssignedAccess(
  db: Db,
  actor: Actor,
  input: { assignmentId: string; reason: AssignmentEndReason; operationId: string },
) {
  return await new CommitteeService(db).endForAdministrator({ ...input, actorId: actor.personId });
}
