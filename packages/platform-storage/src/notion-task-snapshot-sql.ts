/** Shared by scan ingestion and fresh provider reads; older observations cannot revive history. */
export const TASK_SNAPSHOT_UPDATE = `
  revision=CASE WHEN excluded.source_edited_at>=source_edited_at THEN excluded.revision ELSE revision END,
  active=CASE WHEN excluded.source_edited_at>=source_edited_at THEN excluded.active ELSE active END,
  snapshot_json=CASE WHEN excluded.source_edited_at<source_edited_at THEN snapshot_json
    WHEN excluded.active=0 AND history_cleared_at IS NOT NULL THEN '{}' ELSE excluded.snapshot_json END,
  inactive_since=CASE WHEN excluded.source_edited_at<source_edited_at THEN inactive_since
    WHEN excluded.active=1 THEN NULL ELSE coalesce(inactive_since,excluded.updated_at) END,
  history_cleared_at=CASE WHEN excluded.source_edited_at>=source_edited_at AND excluded.active=1
    THEN NULL ELSE history_cleared_at END,
  source_edited_at=max(source_edited_at,excluded.source_edited_at),
  seen_scan_id=excluded.seen_scan_id,updated_at=excluded.updated_at`;
