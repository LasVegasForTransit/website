import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { ProviderConfiguration } from '@lasvegasfortransit/platform-core/access';
import type { SqlValue } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';

/** Shared canonical entitlement for the review and its conditional actions. */
export function googleExpectedAccess(person: string, group: string): string {
  return `(${person}.deleted_at IS NULL AND ${person}.membership_status='member' AND (
    (${group}=(SELECT console_group FROM settings) AND (
      EXISTS(SELECT 1 FROM staff_administrators WHERE person_id=${person}.id)
      OR EXISTS(SELECT 1 FROM committee_assignments WHERE person_id=${person}.id AND ended_at IS NULL AND role='lead')))
    OR EXISTS(SELECT 1 FROM committee_assignments a JOIN committees c ON c.id=a.committee_id
      WHERE a.person_id=${person}.id AND a.ended_at IS NULL AND c.workspace_group_email=${group})))`;
}

/** Parameters: configured, customer, explicit group registry, console group, now, viewer. */
export const GOOGLE_GROUP_QUERY = `WITH settings AS (
  SELECT ? AS configured,? AS customer,? AS resources,? AS console_group,? AS now
), viewer AS (SELECT ${STAFF_ADMIN_SCOPE} AS allowed),
links AS (
  SELECT workspace_group_email AS group_email,id AS committee_id,name,1 AS current FROM committees WHERE workspace_group_email IS NOT NULL
  UNION ALL SELECT m.external_id,c.id,c.name,0 FROM committee_account_mappings m JOIN committees c ON c.id=m.committee_id WHERE m.provider='google_workspace'
), committee_links AS (
  SELECT group_email,committee_id,name,max(current) AS current FROM links GROUP BY group_email,committee_id
), targets AS (
  SELECT group_email FROM committee_links UNION SELECT console_group FROM settings WHERE console_group IS NOT NULL
), owners AS (
  SELECT i.person_id,i.external_id FROM identities i JOIN people p ON p.id=i.person_id AND p.deleted_at IS NULL
  WHERE i.platform='google_workspace' AND i.link_method IN ('self_linked','staff_confirmed')
  AND (SELECT count(*) FROM identities other WHERE other.person_id=p.id AND other.platform='google_workspace')=1
), expected_candidates AS (
  SELECT DISTINCT c.workspace_group_email AS group_email,p.id AS person_id FROM people p
  JOIN committee_assignments a ON a.person_id=p.id AND a.ended_at IS NULL JOIN committees c ON c.id=a.committee_id
  WHERE c.workspace_group_email IS NOT NULL AND ${googleExpectedAccess('p', 'c.workspace_group_email')}
  UNION SELECT s.console_group,p.id FROM people p CROSS JOIN settings s WHERE s.console_group IS NOT NULL
    AND ${googleExpectedAccess('p', 's.console_group')}
), holders AS (
  SELECT m.* FROM google_group_inventory_members m CROSS JOIN settings s CROSS JOIN viewer v
  WHERE v.allowed AND s.configured AND m.context_id=s.customer AND m.group_email IN (SELECT value FROM json_each(s.resources))
), expected AS (
  SELECT e.*,o.external_id AS identity_id FROM expected_candidates e LEFT JOIN owners o ON o.person_id=e.person_id
), differences AS (
  SELECT e.group_email,e.person_id,e.identity_id,CASE WHEN e.identity_id IS NULL THEN 'unconfirmed' ELSE 'missing' END AS state
  FROM expected e WHERE NOT EXISTS(SELECT 1 FROM holders h WHERE h.group_email=e.group_email AND h.member_type='USER' AND h.member_id=e.identity_id)
  UNION ALL SELECT h.group_email,o.person_id,o.external_id,'unexpected' FROM holders h JOIN owners o ON o.external_id=h.member_id
  WHERE h.member_type='USER' AND NOT EXISTS(SELECT 1 FROM expected e WHERE e.group_email=h.group_email AND e.person_id=o.person_id)
), facts AS (
  SELECT t.group_email,coalesce(t.group_email=s.console_group,0) AS is_console,
    i.group_id,i.content_hash,i.started_at,i.observed_at,i.expires_at,i.member_count,i.user_count,
    (SELECT count(*) FROM holders h WHERE h.group_email=t.group_email) AS actual_count,
    (SELECT count(*) FROM holders h WHERE h.group_email=t.group_email AND h.member_type='USER') AS actual_users,
    EXISTS(SELECT 1 FROM holders h WHERE h.group_email=t.group_email AND h.member_type IN ('CUSTOMER','EXTERNAL')) AS unbounded,
    (SELECT count(*) FROM expected e WHERE e.group_email=t.group_email) AS expected_count,
    (SELECT count(*) FROM differences d WHERE d.group_email=t.group_email AND d.state='missing') AS missing_count,
    (SELECT count(*) FROM differences d WHERE d.group_email=t.group_email AND d.state='unexpected') AS unexpected_count,
    (SELECT count(*) FROM differences d WHERE d.group_email=t.group_email AND d.state='unconfirmed') AS unconfirmed_count,
    (SELECT count(*) FROM holders h WHERE h.group_email=t.group_email AND h.member_type='USER' AND NOT EXISTS(SELECT 1 FROM owners o WHERE o.external_id=h.member_id)) AS unmatched_count,
    CASE WHEN NOT s.configured OR t.group_email NOT IN (SELECT value FROM json_each(s.resources)) THEN 'not_configured'
      WHEN f.started_at IS NOT NULL AND (i.started_at IS NULL OR f.started_at>=i.started_at) THEN 'unavailable'
      WHEN i.group_id IS NULL OR i.observed_at>s.now OR i.started_at>s.now THEN 'not_checked'
      WHEN i.expires_at<=s.now THEN 'stale' ELSE 'candidate' END AS check_state
  FROM targets t CROSS JOIN settings s CROSS JOIN viewer v
  LEFT JOIN google_group_inventory i ON v.allowed AND s.configured AND i.context_id=s.customer AND i.group_email=t.group_email
    AND t.group_email IN (SELECT value FROM json_each(s.resources))
  LEFT JOIN google_group_check_failures f ON v.allowed AND s.configured AND f.context_id=s.customer AND f.group_email=t.group_email
    AND t.group_email IN (SELECT value FROM json_each(s.resources))
  WHERE v.allowed
), summaries AS (
  SELECT *,CASE WHEN check_state<>'candidate' THEN check_state
    WHEN user_count IS NULL OR unbounded OR actual_count<>member_count OR actual_users<>user_count THEN 'needs_review' ELSE 'current' END AS state
  FROM facts
)`;

export const GROUP_JSON = `json_object('groupEmail',group_email,'groupId',group_id,'contentHash',content_hash,
  'startedAt',started_at,'checkedAt',observed_at,'expiresAt',expires_at,'isConsole',is_console,'state',state,
  'userCount',CASE WHEN state='current' THEN user_count END,'lastUserCount',CASE WHEN actual_count=member_count AND actual_users=user_count AND NOT unbounded THEN user_count END,
  'expectedCount',expected_count,'missingCount',CASE WHEN state='current' THEN missing_count END,
  'unexpectedCount',CASE WHEN state='current' THEN unexpected_count END,'unmatchedCount',CASE WHEN state='current' THEN unmatched_count END,
  'unconfirmedCount',CASE WHEN state='current' THEN unconfirmed_count END,
  'needsSeatReview',CASE WHEN is_console AND state='current' AND user_count>=45 THEN 1 ELSE 0 END,
  'committees',json((SELECT json_group_array(json_object('id',committee_id,'name',name,'current',current)) FROM committee_links l WHERE l.group_email=summaries.group_email)))`;
export const HAS_PROBLEM = `(state<>'current' OR missing_count+unexpected_count+unmatched_count+unconfirmed_count>0)`;

export function googleGroupQueryParameters(
  actor: Actor,
  query: { configuration: ProviderConfiguration; consoleGroupEmail: string | null; now: Date },
): SqlValue[] {
  return [
    Number(query.configuration.configured),
    query.configuration.contextId,
    JSON.stringify(query.configuration.resourceIds ?? []),
    query.consoleGroupEmail,
    query.now.toISOString(),
    actor.personId,
  ];
}
