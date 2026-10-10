import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db, SqlValue, Statement } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import type { MergeSnapshot } from './merge-state';
export interface MergeOperation {
  id: string;
  actorId: string;
  operationId: string;
  kind: 'person.merge' | 'person.unmerge';
  payload: string;
  reason: string;
  stamp: string;
  survivorId: string;
  mergedId: string;
}
export const FRESH_MERGE = `EXISTS(SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND kind=? AND target_id=? AND payload=? AND applied_at IS NULL)`;
export function freshMerge(input: MergeOperation): SqlValue[] {
  return [input.operationId, input.actorId, input.kind, input.id, input.payload];
}
export async function mergeAuthorized(db: Db, actorId: string): Promise<boolean> {
  return Boolean(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actorId).first());
}
export function mergeReceipt(db: Db, input: MergeOperation, snapshots: MergeSnapshot[]): Statement {
  return db
    .prepare(
      `INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,created_at)
    SELECT ?,?,?,?,?,? WHERE ${STAFF_ADMIN_SCOPE} AND ${snapshots.map((snapshot) => `${snapshot.sql}=?`).join(' AND ')} ON CONFLICT(operation_id) DO NOTHING`,
    )
    .bind(
      input.operationId,
      input.actorId,
      input.kind,
      input.id,
      input.payload,
      input.stamp,
      input.actorId,
      ...snapshots.flatMap((snapshot) => [...snapshot.values, snapshot.json]),
    );
}
export async function mergeReplay(
  db: Db,
  input: { actorId: string; operationId: string; kind: string; payload: string },
): Promise<MutationResult<{ mergeId: string }> | null> {
  const prior = await db
    .prepare(
      'SELECT actor_id,kind,payload,result,applied_at FROM staff_operations WHERE operation_id=?',
    )
    .bind(input.operationId)
    .first<{
      actor_id: string;
      kind: string;
      payload: string;
      result: string | null;
      applied_at: string | null;
    }>();
  if (!prior) return null;
  if (
    prior.actor_id !== input.actorId ||
    prior.kind !== input.kind ||
    prior.payload !== input.payload ||
    !prior.result ||
    !prior.applied_at
  )
    return { kind: 'conflict' };
  return { kind: 'ok', value: JSON.parse(prior.result) as { mergeId: string } };
}
export function finishMerge(db: Db, input: MergeOperation): Statement[] {
  return [
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at) SELECT ?,?,?,?,?,?,? WHERE ${FRESH_MERGE}`,
      )
      .bind(
        ulid(),
        input.actorId,
        input.kind,
        input.id,
        input.payload,
        input.operationId,
        input.stamp,
        ...freshMerge(input),
      ),
    db
      .prepare(
        `UPDATE staff_operations SET applied_at=?,result=? WHERE operation_id=? AND ${FRESH_MERGE}`,
      )
      .bind(
        input.stamp,
        JSON.stringify({ mergeId: input.id }),
        input.operationId,
        ...freshMerge(input),
      ),
  ];
}
export function invalidateMergedAccess(db: Db, input: MergeOperation): Statement[] {
  return ['sessions', 'sign_in_codes']
    .map((table) =>
      db
        .prepare(`DELETE FROM ${table} WHERE person_id IN (?,?) AND ${FRESH_MERGE}`)
        .bind(input.survivorId, input.mergedId, ...freshMerge(input)),
    )
    .concat([
      db
        .prepare(`DELETE FROM staff_form_tokens WHERE actor_id IN (?,?) AND ${FRESH_MERGE}`)
        .bind(input.survivorId, input.mergedId, ...freshMerge(input)),
      db
        .prepare(
          `DELETE FROM welcome_claims WHERE (person_id IN (?,?) OR actor_id IN (?,?)) AND ${FRESH_MERGE}`,
        )
        .bind(
          input.survivorId,
          input.mergedId,
          input.survivorId,
          input.mergedId,
          ...freshMerge(input),
        ),
    ]);
}
export function recomputeMergeMembership(
  db: Db,
  input: MergeOperation,
  personId: string,
): Statement {
  return db
    .prepare(
      `UPDATE people SET membership_status=CASE WHEN EXISTS(SELECT 1 FROM consent_records WHERE person_id=people.id AND scope='newsletter' AND withdrawn_at IS NULL) THEN 'member'
    WHEN EXISTS(SELECT 1 FROM consent_records WHERE person_id=people.id AND scope='newsletter' AND withdrawn_at IS NOT NULL) THEN 'former_member' ELSE 'not_member' END,membership_rules_version=1,updated_at=? WHERE id=? AND ${FRESH_MERGE}`,
    )
    .bind(input.stamp, personId, ...freshMerge(input));
}
export function mergeReconciliation(db: Db, input: MergeOperation): Statement[] {
  return [input.survivorId, input.mergedId].flatMap((personId) => [
    db
      .prepare(
        `INSERT INTO reconcile_generations(person_id,target_id,generation) SELECT ?,'person',1 WHERE ${FRESH_MERGE} ON CONFLICT(person_id,target_id) DO UPDATE SET generation=generation+1`,
      )
      .bind(personId, ...freshMerge(input)),
    db
      .prepare(
        `UPDATE reconcile_generations SET generation=generation+1 WHERE person_id=? AND target_id<>'person' AND ${FRESH_MERGE}`,
      )
      .bind(personId, ...freshMerge(input)),
    db
      .prepare(
        `UPDATE integration_outbox SET state='superseded',updated_at=? WHERE person_id=? AND state IN ('queued','retry','running') AND ${FRESH_MERGE}`,
      )
      .bind(input.stamp, personId, ...freshMerge(input)),
    db
      .prepare(
        `INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
      SELECT ?,'person_reconcile',?,'person',generation,?,?,?,? FROM reconcile_generations WHERE person_id=? AND target_id='person' AND ${FRESH_MERGE}`,
      )
      .bind(
        ulid(),
        personId,
        JSON.stringify({ mergeId: input.id, action: input.kind, survivorId: input.survivorId }),
        input.stamp,
        input.stamp,
        input.stamp,
        personId,
        ...freshMerge(input),
      ),
  ]);
}
