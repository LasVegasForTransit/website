/** Repository-owned SQL aliases; expired snapshots naturally remove these optional display hints. */
export function notionAssigneeNameSql(source: string, notion: string): string {
  return `(SELECT json_extract(label.value,'$.name') FROM task_checkin_tasks named,
    json_each(named.snapshot_json,'$.assigneeLabels') label
    WHERE named.source_id=${source} AND json_extract(label.value,'$.id')=${notion}
      AND label.type='object' AND json_type(label.value,'$.name')='text'
    ORDER BY named.updated_at DESC,named.task_id LIMIT 1)`;
}
