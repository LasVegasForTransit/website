import type { Db, Statement } from './db';

interface RetentionSource {
  id: string;
  revision: number;
  retention_days: number;
  workspace_id: string;
}
/** Rotate across sources even while sending is disabled or a provider is unavailable. */
export async function taskRetentionWrites(db: Db, now: Date, limit: number): Promise<Statement[]> {
  const source = await db
    .prepare(
      `SELECT id,revision,retention_days,workspace_id FROM task_checkin_sources
    ORDER BY coalesce(retention_checked_at,''),id LIMIT 1`,
    )
    .first<RetentionSource>();
  if (!source) return [];
  const stamp = now.toISOString();
  const cutoff = new Date(now.getTime() - source.retention_days * 86_400_000).toISOString();
  const guard = `EXISTS(SELECT 1 FROM task_checkin_sources WHERE id=? AND revision=? AND retention_days=?)`;
  const authority = [source.id, source.revision, source.retention_days];
  return [
    db
      .prepare(
        `UPDATE discord_work_operations SET payload_json='{}',grant_version='',
      state=CASE WHEN state IN ('preview','queued','retryable') THEN 'superseded' ELSE state END,
      reason=CASE WHEN state IN ('preview','queued','retryable') THEN 'retention_expired' ELSE reason END
      WHERE id IN (SELECT id FROM discord_work_operations WHERE json_extract(scope_key,'$[2]')=? AND payload_json<>'{}'
      AND coalesce(json_extract(payload_json,'$.taskSourceId'),(SELECT json_extract(h.data_json,'$.taskSourceId') FROM discord_project_homes h WHERE h.id=discord_work_operations.home_id),?)=?
      AND (created_at<=? OR (state='preview' AND expires_at<=?)) AND (state<>'processing' OR lease_expires_at<=?)
      ORDER BY created_at,id LIMIT ?) AND ${guard}`,
      )
      .bind(source.workspace_id, source.id, source.id, cutoff, stamp, stamp, limit, ...authority),
    db
      .prepare(
        `UPDATE task_checkin_tasks SET snapshot_json='{}',history_cleared_at=?
      WHERE source_id=? AND task_id IN (SELECT task_id FROM task_checkin_tasks
        WHERE source_id=? AND history_cleared_at IS NULL
        AND ((active=0 AND inactive_since<=?) OR (active=1 AND updated_at<=?))
        ORDER BY coalesce(inactive_since,updated_at),task_id LIMIT ?) AND ${guard}`,
      )
      .bind(stamp, source.id, source.id, cutoff, cutoff, limit, ...authority),
    db
      .prepare(
        `UPDATE task_checkin_operations SET
          payload_json=CASE WHEN kind='delivery' THEN json_object('kind',json_extract(payload_json,'$.kind'),
            'slot',json_extract(payload_json,'$.slot'),'scheduledAt',json_extract(payload_json,'$.scheduledAt'),
            'policyKey',json_extract(payload_json,'$.policyKey')) ELSE '{}' END,
          result_json=NULL,history_cleared_at=coalesce(history_cleared_at,?),
          state=CASE WHEN state='processing' THEN 'held'
            WHEN kind<>'delivery' AND state IN ('queued','retryable') THEN 'failed' ELSE state END,
          reason=CASE WHEN state='processing' THEN 'unconfirmed_effect'
            WHEN kind<>'delivery' AND state IN ('queued','retryable') THEN 'retention_expired' ELSE reason END,
          claim_token=NULL,lease_expires_at=NULL
        WHERE id IN (SELECT id FROM task_checkin_operations WHERE source_id=? AND created_at<=?
          AND (state<>'processing' OR lease_expires_at<=?)
          AND (history_cleared_at IS NULL OR result_json IS NOT NULL OR (kind<>'delivery' AND payload_json<>'{}'))
          ORDER BY created_at,id LIMIT ?) AND ${guard}`,
      )
      .bind(stamp, source.id, cutoff, stamp, limit, ...authority),
    db
      .prepare(
        `UPDATE task_checkin_sources SET retention_checked_at=? WHERE id=? AND revision=? AND retention_days=?`,
      )
      .bind(stamp, ...authority),
  ];
}
