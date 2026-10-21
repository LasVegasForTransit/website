import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { taskMappingMatches, taskPersonCanonical } from './notion-task-person-lineage';
export interface HeldTask {
  task_id: string;
  task_title: string | null;
  reason: string;
}
export interface TaskParticipant {
  person_id: string;
  person_name: string | null;
  preference_state: 'active' | 'paused' | 'opted_out' | null;
  consent_current: number;
  cohort_ready: number;
  identity_ready: number;
  mapping_ready: number;
}
/** Read-only current choices and source validation, never message bodies or staff opt-in. */
export async function taskCheckinReadiness(
  db: Db,
  actor: Actor,
  sourceId: string,
  options: { heldCursor?: string; personCursor?: string } = {},
) {
  const held = await db
    .prepare(
      `SELECT t.task_id,json_extract(t.snapshot_json,'$.title') AS task_title,
    json_extract(t.snapshot_json,'$.ineligibleReason') AS reason FROM task_checkin_tasks t
    WHERE t.source_id=? AND t.task_id>? AND t.active=0
      AND coalesce(json_extract(t.snapshot_json,'$.status'),'')<>'Done'
      AND json_extract(t.snapshot_json,'$.ineligibleReason') IN
        ('missing_name','invalid_link','incomplete_assignment','unassigned','incomplete_project',
         'invalid_deadline','unconfirmed_date_range','unsupported_status')
      AND ${STAFF_ADMIN_SCOPE} ORDER BY t.task_id LIMIT 51`,
    )
    .bind(sourceId, options.heldCursor ?? '', actor.personId)
    .all<HeldTask>();
  const people = await db
    .prepare(
      `WITH pool AS (
    SELECT cohort.value AS id FROM task_checkin_sources s JOIN json_each(s.policy_json,'$.cohortPersonIds') cohort
      WHERE s.id=? AND cohort.type='text'
    UNION SELECT person_id FROM task_checkin_consents WHERE source_id=?),
    selected AS (SELECT DISTINCT (${taskPersonCanonical('pool.id')}) AS id FROM pool)
    SELECT p.id AS person_id,nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),'') AS person_name,
      c.state AS preference_state,CASE WHEN c.policy_revision=s.revision THEN 1 ELSE 0 END AS consent_current,
      EXISTS(SELECT 1 FROM json_each(s.policy_json,'$.cohortPersonIds') cohort WHERE cohort.value=p.id) AS cohort_ready,
      EXISTS(SELECT 1 FROM identities i WHERE i.person_id=p.id AND i.platform='discord'
        AND i.link_method IN ('self_linked','staff_confirmed')
        AND (SELECT count(*) FROM identities all_ids WHERE all_ids.person_id=p.id AND all_ids.platform='discord')=1
        AND NOT EXISTS(SELECT 1 FROM discord_disconnects d WHERE d.identity_record_id=i.id)) AS identity_ready,
      EXISTS(SELECT 1 FROM task_checkin_mappings m WHERE m.workspace_id=s.workspace_id AND ${taskMappingMatches('m', 'p.id')}) AS mapping_ready
    FROM task_checkin_sources s JOIN selected JOIN people p ON p.id=selected.id
    LEFT JOIN task_checkin_consents c ON c.source_id=s.id AND c.person_id=p.id
    WHERE s.id=? AND p.id>? AND p.deleted_at IS NULL AND ${STAFF_ADMIN_SCOPE}
    ORDER BY p.id LIMIT 51`,
    )
    .bind(sourceId, sourceId, sourceId, options.personCursor ?? '', actor.personId)
    .all<TaskParticipant>();
  const heldItems = held.results.slice(0, 50),
    peopleItems = people.results.slice(0, 50);
  return {
    heldTasks: {
      items: heldItems,
      nextCursor: held.results.length > 50 ? (heldItems.at(-1)?.task_id ?? null) : null,
    },
    participants: {
      items: peopleItems,
      nextCursor: people.results.length > 50 ? (peopleItems.at(-1)?.person_id ?? null) : null,
    },
  };
}
