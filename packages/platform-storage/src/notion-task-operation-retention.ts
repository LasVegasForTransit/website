/** Operation alias o; the caller binds its clock at the placeholder. Never use for card aliases. */
export const TASK_OPERATION_RETAINED_SQL = `(o.kind='delivery' OR (o.history_cleared_at IS NULL
  AND EXISTS(SELECT 1 FROM task_checkin_sources age_source WHERE age_source.id=o.source_id
    AND julianday(o.created_at)>julianday(?)-age_source.retention_days)))`;
