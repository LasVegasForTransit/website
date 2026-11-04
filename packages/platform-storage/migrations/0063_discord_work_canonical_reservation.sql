-- Refuse overlapping in-flight creations even when Notion UUIDs have different spellings.
-- Existing collisions need an operator to reconcile possible provider effects.
CREATE UNIQUE INDEX discord_work_provision_reservation_canonical ON discord_work_operations(
  scope_key,
  json_extract(payload_json,'$.subject.kind'),
  lower(replace(json_extract(payload_json,'$.subject.sourceId'),'-','')),
  lower(replace(json_extract(payload_json,'$.subject.pageId'),'-',''))
) WHERE kind='provision' AND state IN ('queued','retryable','processing','held');
