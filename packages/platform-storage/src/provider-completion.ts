import type { Db } from './db';
import { PERSON_OPERATION_ELIGIBLE } from './outbox';
import { OUTBOX_CANDIDATES, claimOutboxSelection } from './outbox-selection';

export interface ProviderCompletionOptions {
  limit?: number;
  now?: Date;
}

/** Close a shared operation only after every verified linked provider has a fresh success.
 * Opaque keys preserve deletion state after physical profile retention.
 */
export async function completeProviderOperations(
  db: Db,
  options: ProviderCompletionOptions = {},
): Promise<number> {
  const limit = options.limit ?? 100;
  const now = options.now ?? new Date();
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isFinite(now.getTime()))
    throw new Error('Invalid provider completion configuration');

  const result = await db.batch([
    claimOutboxSelection(db, 'completion', now.toISOString()),
    db
      .prepare(
        `${OUTBOX_CANDIDATES} UPDATE integration_outbox SET state='done',last_failure=NULL,updated_at=?
    WHERE id IN (
      SELECT o.id FROM candidate_page candidate CROSS JOIN integration_outbox o ON o.id=candidate.id
      JOIN reconcile_generations g ON g.person_id=o.person_id
        AND g.target_id=o.target_id AND g.generation=o.generation
      JOIN person_keys p ON p.id=o.person_id
      WHERE o.kind IN ('person_reconcile','committee_reconcile')
        AND o.state IN ('queued','running','retry') AND o.next_attempt_at<=?
        AND ${PERSON_OPERATION_ELIGIBLE}
        AND NOT EXISTS (
          SELECT 1 FROM identities i WHERE i.person_id=o.person_id
            AND i.platform='discord' AND (
              i.link_method NOT IN ('self_linked','staff_confirmed')
              OR EXISTS (SELECT 1 FROM discord_disconnects d WHERE d.identity_record_id=i.id)
              OR (SELECT count(*) FROM identities linked
                WHERE linked.person_id=i.person_id AND linked.platform=i.platform)<>1
              OR NOT EXISTS (
                SELECT 1 FROM provider_operation_receipts r WHERE r.operation_id=o.id
                  AND r.provider='discord' AND r.state='done'
                  AND r.expires_at>? AND r.observed_at<=?
              )
            )
        )
        AND NOT EXISTS (
          SELECT 1 FROM identities i WHERE i.person_id=o.person_id
            AND i.platform='google_workspace' AND (
              i.link_method NOT IN ('self_linked','staff_confirmed')
              OR (SELECT count(*) FROM identities linked
                WHERE linked.person_id=i.person_id AND linked.platform=i.platform)<>1
              OR NOT EXISTS (
                SELECT 1 FROM provider_operation_receipts r WHERE r.operation_id=o.id
                  AND r.provider='google_workspace' AND r.state='done'
                  AND r.expires_at>? AND r.observed_at<=?
              )
            )
        )
        AND NOT EXISTS (
          SELECT 1 FROM identities i WHERE i.person_id=o.person_id
            AND i.platform NOT IN ('discord','google_workspace')
        )
      ORDER BY candidate.lane,o.created_at,o.id LIMIT ?
    )`,
      )
      .bind(
        'completion',
        now.toISOString(),
        now.toISOString(),
        now.toISOString(),
        now.toISOString(),
        now.toISOString(),
        now.toISOString(),
        limit,
      ),
  ]);
  const completed = result[1] as { meta: { changes: number } };
  return completed.meta.changes;
}
