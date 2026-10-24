/** SQL expressions are repository-owned aliases, never request values. Only live, unerased merge links participate. */
export function taskPersonOrigins(personExpression: string): string {
  return `WITH RECURSIVE checkin_origins(id) AS (
    SELECT id FROM people WHERE id=${personExpression} AND deleted_at IS NULL AND erased_at IS NULL
    UNION SELECT link.merged_person_id FROM merges link JOIN checkin_origins parent ON link.surviving_person_id=parent.id
      JOIN people archived ON archived.id=link.merged_person_id AND archived.deleted_at=link.merged_at AND archived.erased_at IS NULL
      WHERE link.unmerged_at IS NULL AND link.erased_at IS NULL
  ) SELECT id FROM checkin_origins`;
}
export function taskPersonCanonical(personExpression: string): string {
  return `WITH RECURSIVE checkin_canonical(id) AS (
    SELECT id FROM people WHERE id=${personExpression} AND erased_at IS NULL
    UNION SELECT link.surviving_person_id FROM merges link JOIN checkin_canonical child ON link.merged_person_id=child.id
      JOIN people archived ON archived.id=child.id AND archived.deleted_at=link.merged_at AND archived.erased_at IS NULL
      WHERE link.unmerged_at IS NULL AND link.erased_at IS NULL
  ) SELECT id FROM people WHERE id IN (SELECT id FROM checkin_canonical)
    AND deleted_at IS NULL AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM merges outgoing
      WHERE outgoing.merged_person_id=people.id AND outgoing.unmerged_at IS NULL AND outgoing.erased_at IS NULL) LIMIT 1`;
}
/** Multiple Notion accounts in one merged family need review; no account is chosen implicitly. */
export function taskMappingMatches(mappingAlias: string, personExpression: string): string {
  return `${mappingAlias}.person_id IN (${taskPersonOrigins(personExpression)})
    AND NOT EXISTS(SELECT 1 FROM task_checkin_mappings duplicate_mapping
      WHERE duplicate_mapping.workspace_id=${mappingAlias}.workspace_id
        AND duplicate_mapping.notion_user_id<>${mappingAlias}.notion_user_id
        AND duplicate_mapping.person_id IN (${taskPersonOrigins(personExpression)}))`;
}
