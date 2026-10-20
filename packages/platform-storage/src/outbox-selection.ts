import type { Db, Statement } from './db';

const ACTIVE = `kind IN ('person_reconcile','committee_reconcile') AND state IN ('queued','running','retry')`;
const LANE = `CASE WHEN json_extract(payload,'$.source') IN ('person_deleted','discord_disconnect','committee.end')
    OR json_extract(payload,'$.removal')=1 THEN 0
    WHEN json_extract(payload,'$.source')='discord_drift' THEN 2 ELSE 1 END`;
function lanePage(lane: number, limit: number): string {
  const range = (
    comparison: '>' | '<=',
  ) => `SELECT id,next_attempt_at,${lane} AS lane FROM integration_outbox INDEXED BY integration_outbox_selection
    WHERE ${ACTIVE} AND ${LANE}=${lane} AND next_attempt_at<=(SELECT stamp FROM selection)
      AND (next_attempt_at,id)${comparison}(
        coalesce((SELECT next_attempt_at FROM outbox_selection_cursors WHERE selector=(SELECT selector FROM selection) AND lane=${lane}),''),
        coalesce((SELECT operation_id FROM outbox_selection_cursors WHERE selector=(SELECT selector FROM selection) AND lane=${lane}),''))
    ORDER BY next_attempt_at,id LIMIT ${limit}`;
  // Both indexed ranges are bounded; the second fills a short page at wraparound.
  return `SELECT * FROM (${range('>')}) UNION ALL SELECT * FROM (${range('<=')}) LIMIT ${limit}`;
}
/** Only claimed opaque operation keys enter the expensive provider filters. */
export const OUTBOX_CANDIDATES = `WITH candidate_page AS MATERIALIZED (
  SELECT value AS id,c.lane FROM outbox_selection_cursors c,json_each(c.page_ids) WHERE c.selector=?)`;

/** Claim before filtering in one batch so completion cannot skip the following page. */
export function claimOutboxSelection(
  db: Db,
  selector: 'discord' | 'completion',
  stamp: string,
): Statement {
  return db
    .prepare(
      `WITH selection(selector,stamp) AS (VALUES(?,?)),
    urgent_page AS MATERIALIZED (${lanePage(0, 16)}),
    explicit_page AS MATERIALIZED (${lanePage(1, 16)}),
    periodic_page AS MATERIALIZED (${lanePage(2, 32)}),
    candidate_page AS MATERIALIZED (SELECT * FROM urgent_page UNION ALL SELECT * FROM explicit_page UNION ALL SELECT * FROM periodic_page),
    lanes(lane) AS (VALUES(0),(1),(2))
    INSERT INTO outbox_selection_cursors(selector,lane,next_attempt_at,operation_id,page_ids)
    SELECT selection.selector,lanes.lane,
      coalesce((SELECT next_attempt_at FROM candidate_page WHERE lane=lanes.lane ORDER BY next_attempt_at DESC,id DESC LIMIT 1),''),
      coalesce((SELECT id FROM candidate_page WHERE lane=lanes.lane ORDER BY next_attempt_at DESC,id DESC LIMIT 1),''),
      (SELECT json_group_array(id) FROM candidate_page WHERE lane=lanes.lane)
    FROM selection CROSS JOIN lanes WHERE 1
    ON CONFLICT(selector,lane) DO UPDATE SET next_attempt_at=excluded.next_attempt_at,operation_id=excluded.operation_id,page_ids=excluded.page_ids
    WHERE outbox_selection_cursors.next_attempt_at IS NOT excluded.next_attempt_at
      OR outbox_selection_cursors.operation_id IS NOT excluded.operation_id
      OR outbox_selection_cursors.page_ids IS NOT excluded.page_ids`,
    )
    .bind(selector, stamp);
}
