-- Equivalent UUID spellings must never create competing live mappings or routes.
-- The indexes deliberately fail on existing collisions so an operator can reconcile them.
CREATE UNIQUE INDEX discord_work_project_home_canonical ON discord_project_homes(
  scope_key, lower(replace(source_id, '-', '')), lower(replace(project_id, '-', ''))
) WHERE state<>'unlinked';
CREATE UNIQUE INDEX discord_work_subject_canonical ON discord_work_conversations(
  scope_key, json_extract(data_json, '$.subject.kind'),
  lower(replace(json_extract(data_json, '$.subject.sourceId'), '-', '')),
  lower(replace(json_extract(data_json, '$.subject.pageId'), '-', ''))
) WHERE state<>'unlinked';
CREATE UNIQUE INDEX discord_work_active_route_source_canonical ON discord_work_routes(
  scope_key, lower(replace(source_id, '-', ''))
) WHERE state='active';
