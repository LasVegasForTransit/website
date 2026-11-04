-- Manual and automatic saves of the same Discord message share one identity even
-- when the Notion page UUID is formatted differently.
CREATE UNIQUE INDEX discord_work_comment_source_canonical ON discord_work_operations(
  scope_key, lower(replace(source_key, '-', ''))
) WHERE kind='comment' AND substr(source_key, 1, 8)='comment:';
