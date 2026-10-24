import { taskPersonCanonical, taskMappingMatches } from './notion-task-person-lineage';
import type { Db } from './db';
import { TASK_CHECKIN_AUTHORITY_SQL as ELIGIBLE } from './notion-task-authority';
export interface EscalationCandidate {
  source_id: string;
  task_id: string;
  person_id: string;
  task_revision: string;
  consent_revision: number;
  policy_revision: number;
  snapshot_json: string;
  blocker_id: string | null;
}
export async function listTaskEscalationCandidates(
  db: Db,
  sourceId: string,
  now: Date,
): Promise<EscalationCandidate[]> {
  const rows = await db
    .prepare(
      `WITH o AS (SELECT s.id AS source_id,t.task_id,c.person_id,t.revision AS task_revision,
    c.revision AS consent_revision,s.revision AS policy_revision,t.snapshot_json,
    (SELECT b.id FROM task_checkin_operations b WHERE b.source_id=s.id AND b.task_id=t.task_id
      AND b.person_id=c.person_id AND b.kind='blocker' AND b.state='confirmed' AND b.history_cleared_at IS NULL
      AND julianday(b.created_at)>julianday(?)-s.retention_days ORDER BY b.updated_at DESC,b.id DESC LIMIT 1) AS blocker_id
    FROM task_checkin_sources s JOIN task_checkin_tasks t ON t.source_id=s.id
    JOIN task_checkin_consents c ON c.source_id=s.id WHERE s.id=?
    AND NOT EXISTS(SELECT 1 FROM task_checkin_escalations r WHERE r.source_id=s.id AND r.task_id=t.task_id
      AND r.subject_id=c.person_id AND r.state='review' AND r.reason IN ('routing_provider_unavailable','routing_limit')
      AND r.next_attempt_at>? AND json_extract(s.policy_json,'$.escalation')='project_leads'))
    SELECT o.* FROM o LEFT JOIN task_checkin_cards card ON card.source_id=o.source_id AND card.task_id=o.task_id AND card.person_id=o.person_id
    LEFT JOIN task_checkin_operations b ON b.id=o.blocker_id WHERE ${ELIGIBLE}
    ORDER BY CASE WHEN b.updated_at>coalesce(card.last_escalation_evaluated_at,'') THEN 0 ELSE 1 END,
      coalesce(card.last_escalation_evaluated_at,''),o.task_id,o.person_id LIMIT 3`,
    )
    .bind(now.toISOString(), sourceId, now.toISOString())
    .all<EscalationCandidate>();
  return rows.results;
}
export async function noteTaskEscalationEvaluation(
  db: Db,
  row: EscalationCandidate,
  now: Date,
): Promise<void> {
  await db
    .prepare(
      'UPDATE task_checkin_cards SET last_escalation_evaluated_at=? WHERE source_id=? AND task_id=? AND person_id=?',
    )
    .bind(now.toISOString(), row.source_id, row.task_id, row.person_id)
    .run();
}
export async function taskEscalationMappings(
  db: Db,
  sourceId: string,
  notionIds: string[],
): Promise<Map<string, string>> {
  const rows = await db
    .prepare(
      `SELECT m.notion_user_id,p.id AS person_id FROM task_checkin_mappings m
    JOIN task_checkin_sources s ON s.workspace_id=m.workspace_id
    JOIN people p ON p.id=(${taskPersonCanonical('m.person_id')})
    WHERE s.id=? AND ${taskMappingMatches('m', 'p.id')}
    AND EXISTS(SELECT 1 FROM json_each(?) a WHERE a.value=m.notion_user_id)`,
    )
    .bind(sourceId, JSON.stringify(notionIds))
    .all<{ notion_user_id: string; person_id: string }>();
  return new Map(rows.results.map((row) => [row.notion_user_id, row.person_id]));
}
