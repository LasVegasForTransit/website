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

// A wrapped page ends at its last wrapped key, not at its largest key.
// Persist the sweep start so blocked pages finish a cycle and can sleep.
const CLAIM_OUTBOX_SELECTION = `WITH selection(selector,stamp) AS (VALUES(?,?)),
    urgent_page AS MATERIALIZED (${lanePage(0, 16)}),
    explicit_page AS MATERIALIZED (${lanePage(1, 16)}),
    periodic_page AS MATERIALIZED (${lanePage(2, 32)}),
    candidate_page AS MATERIALIZED (SELECT * FROM urgent_page UNION ALL SELECT * FROM explicit_page UNION ALL SELECT * FROM periodic_page),
    lanes(lane) AS (VALUES(0),(1),(2)),
    previous AS MATERIALIZED (
      SELECT lanes.lane,coalesce(c.next_attempt_at,'') AS next_attempt_at,coalesce(c.operation_id,'') AS operation_id,
        CASE WHEN c.sweep_complete=0 THEN c.sweep_next_attempt_at ELSE coalesce(c.next_attempt_at,'') END AS sweep_next_attempt_at,
        CASE WHEN c.sweep_complete=0 THEN c.sweep_operation_id ELSE coalesce(c.operation_id,'') END AS sweep_operation_id,
        CASE WHEN c.sweep_complete=0 THEN c.sweep_wrapped ELSE 0 END AS sweep_wrapped
      FROM lanes LEFT JOIN outbox_selection_cursors c ON c.selector=(SELECT selector FROM selection) AND c.lane=lanes.lane
    ),
    page_ends AS MATERIALIZED (
      SELECT page.*,row_number() OVER(PARTITION BY page.lane ORDER BY
        CASE WHEN (page.next_attempt_at,page.id)>(p.next_attempt_at,p.operation_id) THEN 0 ELSE 1 END DESC,
        page.next_attempt_at DESC,page.id DESC) AS position
      FROM candidate_page page JOIN previous p ON p.lane=page.lane
    ),
    progress AS MATERIALIZED (
      SELECT p.*,coalesce(ending.next_attempt_at,'') AS end_at,coalesce(ending.id,'') AS end_id,
        ending.id IS NOT NULL AS has_page,
        p.sweep_wrapped OR EXISTS(SELECT 1 FROM candidate_page page WHERE page.lane=p.lane
          AND (page.next_attempt_at,page.id)<=(p.next_attempt_at,p.operation_id)) AS wrapped
      FROM previous p LEFT JOIN page_ends ending ON ending.lane=p.lane AND ending.position=1
    )
    INSERT INTO outbox_selection_cursors(selector,lane,next_attempt_at,operation_id,page_ids,
      sweep_next_attempt_at,sweep_operation_id,sweep_wrapped,sweep_complete)
    SELECT selection.selector,p.lane,p.end_at,p.end_id,
      (SELECT json_group_array(id) FROM candidate_page WHERE lane=p.lane),
      CASE WHEN p.has_page THEN p.sweep_next_attempt_at ELSE '' END,
      CASE WHEN p.has_page THEN p.sweep_operation_id ELSE '' END,CASE WHEN p.has_page THEN p.wrapped ELSE 0 END,
      CASE WHEN p.has_page=0 THEN 1
        WHEN p.sweep_wrapped AND EXISTS(SELECT 1 FROM candidate_page page WHERE page.lane=p.lane
          AND (page.next_attempt_at,page.id)<=(p.next_attempt_at,p.operation_id)) THEN 1
        WHEN p.wrapped AND NOT EXISTS(
          SELECT 1 FROM integration_outbox INDEXED BY integration_outbox_selection
          WHERE ${ACTIVE} AND ${LANE}=p.lane AND next_attempt_at<=selection.stamp
            AND (next_attempt_at,id)>(p.end_at,p.end_id)
            AND (next_attempt_at,id)<=(p.sweep_next_attempt_at,p.sweep_operation_id)) THEN 1
        WHEN p.sweep_next_attempt_at='' AND NOT EXISTS(
          SELECT 1 FROM integration_outbox INDEXED BY integration_outbox_selection
          WHERE ${ACTIVE} AND ${LANE}=p.lane AND next_attempt_at<=selection.stamp
            AND (next_attempt_at,id)>(p.end_at,p.end_id)) THEN 1
        ELSE 0 END
    FROM selection CROSS JOIN progress p WHERE 1
    ON CONFLICT(selector,lane) DO UPDATE SET next_attempt_at=excluded.next_attempt_at,operation_id=excluded.operation_id,page_ids=excluded.page_ids,
      sweep_next_attempt_at=excluded.sweep_next_attempt_at,sweep_operation_id=excluded.sweep_operation_id,
      sweep_wrapped=excluded.sweep_wrapped,sweep_complete=excluded.sweep_complete
    WHERE outbox_selection_cursors.next_attempt_at IS NOT excluded.next_attempt_at
      OR outbox_selection_cursors.operation_id IS NOT excluded.operation_id
      OR outbox_selection_cursors.page_ids IS NOT excluded.page_ids
      OR outbox_selection_cursors.sweep_next_attempt_at IS NOT excluded.sweep_next_attempt_at
      OR outbox_selection_cursors.sweep_operation_id IS NOT excluded.sweep_operation_id
      OR outbox_selection_cursors.sweep_wrapped IS NOT excluded.sweep_wrapped
      OR outbox_selection_cursors.sweep_complete IS NOT excluded.sweep_complete`;

/** Claim before filtering in one batch so completion cannot skip the following page. */
export function claimOutboxSelection(
  db: Db,
  selector: 'discord' | 'completion',
  stamp: string,
): Statement {
  return db.prepare(CLAIM_OUTBOX_SELECTION).bind(selector, stamp);
}

/** A partially wrapped sweep must finish before dormant blocked work can sleep. */
export async function outboxSelectionHasMore(
  db: Db,
  selector: 'discord' | 'completion',
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM outbox_selection_cursors WHERE selector=? AND sweep_complete=0 LIMIT 1')
    .bind(selector)
    .first();
  return Boolean(row);
}
