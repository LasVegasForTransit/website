import { taskMappingMatches } from './notion-task-person-lineage';
import { TASK_CHECKIN_AUTHORITY_SQL } from './notion-task-authority';
export const TASK_ESCALATION_SUBJECT_SQL = TASK_CHECKIN_AUTHORITY_SQL.replaceAll(
  'o.person_id',
  'o.subject_id',
);
/** A support recipient independently opts in; a project lead also needs an explicit workspace mapping. */
export const TASK_ESCALATION_AUTHORITY_SQL = `(${TASK_ESCALATION_SUBJECT_SQL}) AND EXISTS(
  SELECT 1 FROM task_checkin_sources s
  JOIN task_checkin_consents c ON c.source_id=s.id AND c.person_id=o.person_id
  JOIN people p ON p.id=c.person_id AND p.deleted_at IS NULL
  JOIN identities i ON i.person_id=p.id AND i.platform='discord' AND i.external_id=c.discord_user_id
    AND i.link_method IN ('self_linked','staff_confirmed')
  WHERE s.id=o.source_id AND json_extract(s.policy_json,'$.escalationContentApproved')=1 AND c.state='active' AND c.policy_revision=s.revision
    AND c.revision=o.recipient_consent_revision
    AND EXISTS(SELECT 1 FROM json_each(s.policy_json,'$.cohortPersonIds') a WHERE a.value=p.id)
    AND (SELECT count(*) FROM identities j WHERE j.person_id=p.id AND j.platform='discord')=1
    AND NOT EXISTS(SELECT 1 FROM discord_disconnects d WHERE d.identity_record_id=i.id)
    AND ((json_extract(s.policy_json,'$.escalation')='support'
      AND EXISTS(SELECT 1 FROM json_each(s.policy_json,'$.supportPersonIds') a WHERE a.value=p.id))
    OR (json_extract(s.policy_json,'$.escalation')='project_leads' AND o.recipient_notion_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM task_checkin_mappings m WHERE m.workspace_id=s.workspace_id
        AND m.notion_user_id=o.recipient_notion_id AND ${taskMappingMatches('m', 'p.id')})))
  ) AND (o.trigger_kind<>'blocker' OR EXISTS(SELECT 1 FROM task_checkin_operations b
    WHERE b.id=o.blocker_id AND b.source_id=o.source_id AND b.task_id=o.task_id
      AND b.person_id=o.subject_id AND b.kind='blocker' AND b.state='confirmed' AND b.history_cleared_at IS NULL))`;

/** Caller binds its clock; keep expired help text out of provider effects before cleanup catches up. */
export const TASK_ESCALATION_RETAINED_SQL = `(o.trigger_kind<>'blocker' OR EXISTS(
  SELECT 1 FROM task_checkin_operations age_blocker JOIN task_checkin_sources age_source ON age_source.id=age_blocker.source_id
  WHERE age_blocker.id=o.blocker_id AND age_blocker.history_cleared_at IS NULL
    AND julianday(age_blocker.created_at)>julianday(?)-age_source.retention_days))`;
