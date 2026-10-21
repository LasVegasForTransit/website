import { taskMappingMatches } from './notion-task-person-lineage';
// SQL uses the candidate operation or card alias o. Apply it at both intent and effect boundaries.
export const TASK_CHECKIN_AUTHORITY_SQL = `EXISTS(SELECT 1 FROM task_checkin_sources s
  JOIN task_checkin_tasks t ON t.source_id=s.id AND t.task_id=o.task_id AND t.active=1
  JOIN task_checkin_consents c ON c.source_id=s.id AND c.person_id=o.person_id AND c.state='active'
  JOIN people p ON p.id=c.person_id AND p.deleted_at IS NULL
  JOIN identities i ON i.person_id=p.id AND i.platform='discord' AND i.external_id=c.discord_user_id
    AND i.link_method IN ('self_linked','staff_confirmed')
  JOIN task_checkin_mappings m ON m.workspace_id=s.workspace_id AND ${taskMappingMatches('m', 'p.id')}
  WHERE s.id=o.source_id AND s.enabled=1 AND s.revision=o.policy_revision
    AND EXISTS(SELECT 1 FROM json_each(s.policy_json,'$.cohortPersonIds') cohort WHERE cohort.value=p.id)
    AND c.policy_revision=s.revision AND c.revision=o.consent_revision AND t.revision=o.task_revision
    AND EXISTS(SELECT 1 FROM json_each(t.snapshot_json,'$.assigneeIds') a WHERE a.value=m.notion_user_id)
    AND (SELECT count(*) FROM identities j WHERE j.person_id=p.id AND j.platform='discord')=1
    AND NOT EXISTS(SELECT 1 FROM discord_disconnects d WHERE d.identity_record_id=i.id))`;
