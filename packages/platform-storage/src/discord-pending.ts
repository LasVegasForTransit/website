import type { Db } from './db';
import { PERSON_OPERATION_ELIGIBLE } from './outbox';
import { OUTBOX_CANDIDATES, claimOutboxSelection } from './outbox-selection';
/** One due operation per verified account; other providers retain their own completion state.
 * Opaque keys mirror deletion state without materializing every retained profile.
 * Successful unchanged work refreshes hourly; display freshness does not schedule retries.
 */
export async function pendingDiscordOperations(
  db: Db,
  now: Date,
  limit: number,
): Promise<string[]> {
  const result = await db.batch([
    claimOutboxSelection(db, 'discord', now.toISOString()),
    db
      .prepare(
        `${OUTBOX_CANDIDATES} SELECT id FROM (
    SELECT o.id,candidate.lane,o.created_at,coalesce(r.observed_at,'') AS last_observed,
      row_number() OVER (PARTITION BY o.person_id ORDER BY candidate.lane,coalesce(r.observed_at,''),o.created_at,o.id) AS position
    FROM candidate_page candidate CROSS JOIN integration_outbox o ON o.id=candidate.id JOIN reconcile_generations g
      ON g.person_id=o.person_id AND g.target_id=o.target_id AND g.generation=o.generation
    JOIN person_keys p ON p.id=o.person_id
    LEFT JOIN provider_operation_receipts r ON r.operation_id=o.id AND r.provider='discord'
    WHERE o.kind IN ('person_reconcile','committee_reconcile') AND o.state IN ('queued','running','retry')
      AND o.next_attempt_at<=? AND ${PERSON_OPERATION_ELIGIBLE}
      AND (SELECT count(*) FROM identities WHERE person_id=p.id AND platform='discord')=1
      AND EXISTS(SELECT 1 FROM identities WHERE person_id=p.id AND platform='discord' AND link_method IN ('self_linked','staff_confirmed'))
      AND (
        EXISTS(SELECT 1 FROM identities i JOIN discord_disconnects d ON d.identity_record_id=i.id WHERE i.person_id=p.id AND i.platform='discord')
        OR NOT EXISTS(SELECT 1 FROM provider_operation_receipts r WHERE r.operation_id=o.id AND r.provider='discord' AND r.state='done' AND r.observed_at>? AND r.observed_at<=?)
      )
    ) WHERE position=1 ORDER BY lane,last_observed,created_at,id LIMIT ?`,
      )
      .bind(
        'discord',
        now.toISOString(),
        new Date(now.getTime() - 3_600_000).toISOString(),
        now.toISOString(),
        limit,
      ),
  ]);
  const selected = result[1] as { results: { id: string }[] };
  return selected.results.map((row) => row.id);
}
