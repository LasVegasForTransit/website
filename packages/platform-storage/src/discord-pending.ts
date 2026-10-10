import type { Db } from './db';
import { PERSON_OPERATION_ELIGIBLE } from './outbox';
/** One due operation per verified account; other providers retain their own completion state. */
export async function pendingDiscordOperations(
  db: Db,
  now: Date,
  limit: number,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT id FROM (
    SELECT o.id,o.created_at,coalesce(r.observed_at,'') AS last_observed,
      row_number() OVER (PARTITION BY o.person_id ORDER BY coalesce(r.observed_at,''),o.created_at,o.id) AS position
    FROM integration_outbox o JOIN reconcile_generations g
      ON g.person_id=o.person_id AND g.target_id=o.target_id AND g.generation=o.generation
    JOIN reconciliation_people p ON p.id=o.person_id
    LEFT JOIN provider_operation_receipts r ON r.operation_id=o.id AND r.provider='discord'
    WHERE o.kind IN ('person_reconcile','committee_reconcile') AND o.state IN ('queued','running','retry')
      AND o.next_attempt_at<=? AND ${PERSON_OPERATION_ELIGIBLE}
      AND (SELECT count(*) FROM identities WHERE person_id=p.id AND platform='discord')=1
      AND EXISTS(SELECT 1 FROM identities WHERE person_id=p.id AND platform='discord' AND link_method IN ('self_linked','staff_confirmed'))
      AND NOT EXISTS(SELECT 1 FROM provider_operation_receipts r WHERE r.operation_id=o.id AND r.provider='discord' AND r.state='done' AND r.expires_at>?)
    ) WHERE position=1 ORDER BY last_observed,created_at,id LIMIT ?`,
    )
    .bind(now.toISOString(), now.toISOString(), limit)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}
