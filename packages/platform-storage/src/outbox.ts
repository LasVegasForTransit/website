import type { Db } from './db';
export interface OutboxOperation {
  id: string;
  kind: string;
  personId: string;
  targetId: string;
  generation: number;
  payload: Record<string, unknown>;
}
/** Aliases o and p refer to the operation and its canonical person. */
export const PERSON_OPERATION_ELIGIBLE = `(p.deleted_at IS NULL
  OR (o.kind='person_reconcile' AND json_extract(o.payload,'$.source')='person_deleted'
    AND json_extract(o.payload,'$.deletedAt')=p.deleted_at
    AND NOT EXISTS(SELECT 1 FROM merges m WHERE m.merged_person_id=p.id AND m.unmerged_at IS NULL AND m.merged_at=p.deleted_at))
  OR (o.kind='person_reconcile' AND EXISTS(SELECT 1 FROM merges m WHERE m.merged_person_id=p.id
    AND m.id=json_extract(o.payload,'$.mergeId') AND m.surviving_person_id=json_extract(o.payload,'$.survivorId')
    AND m.unmerged_at IS NULL AND p.deleted_at=m.merged_at AND o.created_at>=m.merged_at)))`;
export async function enqueueOperation(db: Db, input: OutboxOperation): Promise<void> {
  const stamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO integration_outbox (id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      input.id,
      input.kind,
      input.personId,
      input.targetId,
      input.generation,
      JSON.stringify(input.payload),
      stamp,
      stamp,
      stamp,
    )
    .run();
}
export async function operationIsCurrent(db: Db, id: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS current FROM integration_outbox o JOIN reconcile_generations g
    ON g.person_id=o.person_id AND g.target_id=o.target_id AND g.generation=o.generation
    JOIN reconciliation_people p ON p.id=o.person_id WHERE o.id=? AND ${PERSON_OPERATION_ELIGIBLE}`,
    )
    .bind(id)
    .first();
  return Boolean(row);
}
export type ProviderFailure =
  'provider_unavailable' | 'rate_limited' | 'permission_denied' | 'unknown';
export async function markOperationFailed(
  db: Db,
  id: string,
  failure: ProviderFailure,
  now: Date = new Date(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE integration_outbox SET state='retry',attempts=attempts+1,last_failure=?,next_attempt_at=?,updated_at=?
    WHERE id=? AND state IN ('queued','running','retry')`,
    )
    .bind(failure, new Date(now.getTime() + 60_000).toISOString(), now.toISOString(), id)
    .run();
}
