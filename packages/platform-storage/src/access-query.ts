import { OBSERVATION_JSON } from './access-state';
import { committeeTargetSql, discordLeadSql } from './discord-target';
const TARGETS = `WITH targets AS (SELECT person_id AS personId,committee_id AS targetId FROM committee_assignments GROUP BY person_id,committee_id
  UNION SELECT a.person_id,'committee_lead:'||a.committee_id FROM committee_assignments a JOIN committees c ON c.id=a.committee_id
    WHERE c.discord_lead_role_id IS NOT NULL OR EXISTS(SELECT 1 FROM committee_account_mappings m WHERE m.committee_id=c.id AND m.provider='discord' AND m.role_kind='lead')
  UNION SELECT person_id,target_id FROM access_observations WHERE target_id<>'person'
  UNION SELECT id,'person' FROM people)`;
const COMMITTEE_TARGET = committeeTargetSql('t.targetId');
const LEAD_TARGET = discordLeadSql('t.targetId');
const CURRENT_JOB = `SELECT o.id FROM integration_outbox o WHERE o.person_id=p.id AND o.target_id=${COMMITTEE_TARGET} AND o.generation=coalesce(g.generation,0)
  AND o.kind IN ('person_reconcile','committee_reconcile') ORDER BY o.created_at DESC,o.id DESC LIMIT 1`;
function observation(provider: string) {
  return `(SELECT ${OBSERVATION_JSON} FROM access_observations WHERE person_id=p.id AND target_id=t.targetId AND provider='${provider}' ORDER BY observed_at DESC,rowid DESC LIMIT 1)`;
}
export const ACCESS_ROWS_QUERY = `${TARGETS}
    SELECT p.id AS personId,t.targetId,coalesce(nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),''),p.email,'') AS name,
    p.email,p.membership_status AS membershipStatus,c.name AS committeeName,a.id AS assignmentId,a.role,
    CASE WHEN p.membership_status='member' AND (t.targetId='person' OR a.id IS NOT NULL) THEN 1 ELSE 0 END AS expectedAccess,
    coalesce(g.generation,0) AS generation,
    (SELECT count(*) FROM identities WHERE person_id=p.id AND platform='google_workspace') AS googleIdentityCount,
    (SELECT count(*) FROM identities WHERE person_id=p.id AND platform='discord') AS discordIdentityCount,
    (SELECT external_id FROM identities WHERE person_id=p.id AND platform='google_workspace') AS googleIdentity,
    (SELECT external_email FROM identities WHERE person_id=p.id AND platform='google_workspace') AS googleEmail,
    (SELECT external_id FROM identities WHERE person_id=p.id AND platform='discord' AND link_method IN ('self_linked','staff_confirmed')) AS discordIdentity,
    CASE WHEN ${LEAD_TARGET} THEN NULL ELSE c.workspace_group_email END AS workspaceGroupEmail,
    CASE WHEN ${LEAD_TARGET} THEN c.discord_lead_role_id ELSE c.discord_role_id END AS discordRoleId,
    CASE WHEN ${LEAD_TARGET} THEN NULL ELSE ${observation('google_workspace')} END AS googleObservation,${observation('discord')} AS discordObservation,
    CASE WHEN p.membership_status='member' AND EXISTS(SELECT 1 FROM committee_assignments eligible JOIN committees mapped ON mapped.id=eligible.committee_id
      WHERE eligible.person_id=p.id AND eligible.ended_at IS NULL AND (mapped.discord_role_id=CASE WHEN ${LEAD_TARGET} THEN c.discord_lead_role_id ELSE c.discord_role_id END
        OR (eligible.role='lead' AND mapped.discord_lead_role_id=CASE WHEN ${LEAD_TARGET} THEN c.discord_lead_role_id ELSE c.discord_role_id END))) THEN 1 ELSE 0 END AS discordExpectedAccess,
    CASE WHEN ${LEAD_TARGET} THEN c.discord_lead_role_id ELSE c.discord_role_id END AS discordResourceId,
    (SELECT first_seen_at FROM access_mismatch_observations mismatch WHERE mismatch.provider='discord' AND mismatch.person_id=p.id
      AND mismatch.resource_id=CASE WHEN ${LEAD_TARGET} THEN c.discord_lead_role_id ELSE c.discord_role_id END
      AND mismatch.expected_access=(CASE WHEN p.membership_status='member' AND EXISTS(SELECT 1 FROM committee_assignments eligible JOIN committees mapped ON mapped.id=eligible.committee_id
      WHERE eligible.person_id=p.id AND eligible.ended_at IS NULL AND (mapped.discord_role_id=CASE WHEN ${LEAD_TARGET} THEN c.discord_lead_role_id ELSE c.discord_role_id END
        OR (eligible.role='lead' AND mapped.discord_lead_role_id=CASE WHEN ${LEAD_TARGET} THEN c.discord_lead_role_id ELSE c.discord_role_id END))) THEN 1 ELSE 0 END)
      AND mismatch.identity_id=(SELECT external_id FROM identities WHERE person_id=p.id AND platform='discord' AND link_method IN ('self_linked','staff_confirmed'))
      AND mismatch.context_id=(SELECT context_id FROM access_observations WHERE person_id=p.id AND target_id=t.targetId AND provider='discord' ORDER BY observed_at DESC,rowid DESC LIMIT 1)) AS discordFirstSeenAt,
    o.id AS operationId,o.state AS operationState,o.last_failure AS lastFailure
    FROM targets t JOIN people p ON p.id=t.personId LEFT JOIN committees c ON c.id=${COMMITTEE_TARGET}
    LEFT JOIN committee_assignments a ON a.person_id=p.id AND a.committee_id=c.id AND a.ended_at IS NULL AND (NOT ${LEAD_TARGET} OR a.role='lead')
    LEFT JOIN reconcile_generations g ON g.person_id=p.id AND g.target_id=${COMMITTEE_TARGET}
    LEFT JOIN integration_outbox o ON o.id=(${CURRENT_JOB})`;
