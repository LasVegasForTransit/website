-- Do not let successive source edits race to change tags on the same conversation.
-- Existing conflicting operations require operator review before this index is applied.
CREATE UNIQUE INDEX discord_work_one_active_tag_sync ON discord_work_operations(scope_key,conversation_id)
WHERE kind='refresh' AND json_extract(payload_json,'$.intent')='tag-sync'
  AND state IN ('queued','retryable','processing','held');
