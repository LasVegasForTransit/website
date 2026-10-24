import type { Db, SqlValue, Statement } from './db';
import { ulid } from '@lasvegasfortransit/platform-core/ids';

export type PersonExportAuthority = {
  personId: string;
  sessionHash: string;
} & (
  | { kind: 'member' }
  | { kind: 'administrator'; workspaceEmail: string }
  | { kind: 'administrator'; sso: { issuer: string; subject: string } }
);

const SESSION_SCOPE = `EXISTS(SELECT 1 FROM sessions s JOIN people viewer ON viewer.id=s.person_id
  WHERE s.person_id=?2 AND s.id_hash=?3 AND julianday(s.expires_at)>julianday(?4)
  AND viewer.deleted_at IS NULL`;
function scope(authority: PersonExportAuthority): string {
  return authority.kind === 'member'
    ? `${SESSION_SCOPE} AND viewer.id=p.id AND (s.type='member' OR (s.type='staff'
      AND EXISTS(SELECT 1 FROM identities wi WHERE wi.id=s.workspace_identity_id
      AND wi.person_id=viewer.id AND wi.platform='google_workspace'))))`
    : `${SESSION_SCOPE} AND s.type='staff' AND viewer.membership_status='member'
      AND EXISTS(SELECT 1 FROM staff_administrators WHERE person_id=viewer.id)
      AND ${
        'sso' in authority
          ? `s.authentication_source='cloudflare-access' AND EXISTS(SELECT 1 FROM staff_sso_links link
          WHERE link.id=s.sso_link_id AND link.person_id=viewer.id AND link.issuer=?5 AND link.subject=?6 AND link.revoked_at IS NULL)`
          : `EXISTS(SELECT 1 FROM identities wi WHERE wi.id=s.workspace_identity_id
          AND wi.person_id=viewer.id AND wi.platform='google_workspace' AND wi.external_email=?5)`
      })`;
}

const PROFILE = `p.id,p.given_name,p.family_name,p.email,p.email_verified_at,p.phone,p.zip,
  p.census_block,p.census_block_vintage,p.place_name,p.preferred_language,p.membership_status,
  p.membership_rules_version,p.region_id,p.region_source,p.region_set_at,p.created_at,p.updated_at,
  (SELECT name FROM regions WHERE id=p.region_id) AS region`;
const IDENTITY = `i.platform,i.external_id,i.external_email,i.linked_at,i.link_method,i.created_at,i.updated_at`;
const ADMINISTRATOR_CORRECTIONS = `SELECT r.corrected_at,r.changes,r.reason,r.actor_id,
  nullif(trim(coalesce(author.given_name,'')||' '||coalesce(author.family_name,'')),'') AS actor_name
  FROM person_corrections r JOIN people p ON p.id=r.person_id
  LEFT JOIN people author ON author.id=r.actor_id AND author.deleted_at IS NULL`;
const QUERIES = {
  current_membership_evidence: `SELECT r.status,r.observed_at,r.source_created_at,r.withdrawn_at,r.entitled,r.recognized_at,r.revoked_at FROM membership_roll r JOIN people p ON p.id=r.person_id`,
  imported_signup_evidence: `SELECT r.source,r.state,
    json_remove(r.evidence,'$.beehiiv','$.form.rawResponseUrl','$.form.responseId','$.newsletter.evidenceReference') AS evidence,
    r.recorded_at FROM roster_import_records r JOIN people p ON p.id=r.person_id`,
  details: `SELECT ${PROFILE} FROM people p`,
  where_each_detail_came_from: `SELECT r.field,r.source,r.confirmed_at,r.created_at,r.updated_at FROM field_sources r JOIN people p ON p.id=r.person_id`,
  consent_records: `SELECT r.scope,r.given_at,r.source,r.method,r.wording_version,r.withdrawn_at,
    r.withdrawn_source,r.withdrawn_time_basis,r.created_at,r.updated_at,
    (SELECT i.platform FROM identities i WHERE i.id=r.origin_identity_id AND i.person_id=p.id) AS origin_account_platform,
    (SELECT i.external_id FROM identities i WHERE i.id=r.origin_identity_id AND i.person_id=p.id) AS origin_account_id
    FROM consent_records r JOIN people p ON p.id=r.person_id`,
  consent_withdrawals: `SELECT r.scope,r.source,r.withdrawn_at,r.recorded_at,r.time_basis,r.source_occurred_at
    FROM consent_withdrawals r JOIN people p ON p.id=r.person_id`,
  connected_accounts: `SELECT ${IDENTITY} FROM identities i JOIN people p ON p.id=i.person_id`,
  discord_account_profiles: `SELECT i.external_id,r.username,r.display_name,r.avatar,r.verified_at
    FROM discord_identity_profiles r JOIN identities i ON i.id=r.identity_record_id JOIN people p ON p.id=i.person_id`,
  discord_server_profiles: `SELECT i.external_id,r.guild_id,r.username,r.display_name,r.avatar,r.nickname,
    r.in_guild,r.pending,r.observed_at,r.expires_at FROM discord_profiles r JOIN identities i ON i.id=r.identity_record_id
    JOIN people p ON p.id=i.person_id`,
  committee_assignments: `SELECT c.id AS committee_id,c.name AS committee_name,r.role,r.started_at,r.ended_at,
    r.end_reason,r.updated_at FROM committee_assignments r JOIN committees c ON c.id=r.committee_id JOIN people p ON p.id=r.person_id`,
  organization_roles: `SELECT d.id AS role_id,d.name,r.assigned_at,r.ended_at,d.retired_at
    FROM person_organization_roles r JOIN organization_roles d ON d.id=r.role_id JOIN people p ON p.id=r.person_id`,
  activity: `SELECT r.type,r.occurred_at,r.created_at,r.details,
    EXISTS(SELECT 1 FROM engagement_events correction WHERE correction.person_id=r.person_id
      AND correction.type='correction' AND correction.reference=r.id) AS corrected
    FROM engagement_events r JOIN people p ON p.id=r.person_id`,
  profile_corrections: `SELECT r.corrected_at,r.changes FROM person_corrections r JOIN people p ON p.id=r.person_id`,
  newsletter_observations: `SELECT i.external_id AS subscription_id,r.status,r.subscription_created_at,r.observed_at
    FROM beehiiv_subscription_observations r JOIN identities i ON i.platform='beehiiv' AND i.external_id=r.subscription_id
    AND julianday(r.observed_at)>=julianday(i.linked_at) JOIN people p ON p.id=i.person_id`,
  newsletter_choices: `SELECT i.external_id AS subscription_id,r.status,r.observed_at,r.last_seen_at
    FROM newsletter_poll_choices r JOIN identities i ON i.platform='beehiiv' AND i.external_id=r.subscription_id
    AND i.person_id=r.person_id AND julianday(r.observed_at)>=julianday(i.linked_at) JOIN people p ON p.id=i.person_id`,
  newsletter_source_events: `SELECT i.external_id AS subscription_id,r.type,r.occurred_at,r.received_at
    FROM newsletter_inbound_events r JOIN identities i ON i.platform='beehiiv' AND i.external_id=r.subscription_id
    AND julianday(r.received_at)>=julianday(i.linked_at) JOIN people p ON p.id=i.person_id
    LEFT JOIN newsletter_source_operations op ON op.publication_id=r.publication_id AND op.event_id=r.id`,
} as const;

export type PersonExportSection = keyof typeof QUERIES;
export function exportStatement(
  db: Db,
  input: { personId: string; authority: PersonExportAuthority; at: string },
  section?: PersonExportSection,
): Statement {
  const { personId, authority, at } = input;
  const query =
    section === 'profile_corrections' && authority.kind === 'administrator'
      ? ADMINISTRATOR_CORRECTIONS
      : section
        ? QUERIES[section]
        : null;
  const values: SqlValue[] = [personId, authority.personId, authority.sessionHash, at];
  if (authority.kind === 'administrator') {
    if ('sso' in authority) values.push(authority.sso.issuer, authority.sso.subject);
    else values.push(authority.workspaceEmail);
  }
  // The final scope check writes its receipt atomically, so stale authority
  // cannot leave an audit entry for a refused export.
  const receipt = `INSERT INTO staff_audits(id,actor_id,action,permission,target_id,details,occurred_at)
    SELECT ?${values.length + 1},?2,'person.export',${authority.kind === 'administrator' ? "'export.full'" : 'NULL'},
    p.id,json_object('requested_by',${authority.kind === 'administrator' ? '?2' : "'member'"}),?4 FROM people p`;
  if (!section) values.push(ulid());
  return db
    .prepare(
      `${query ?? receipt}
    WHERE p.id=?1 AND p.deleted_at IS NULL AND ${scope(authority)}
    ${section === 'newsletter_source_events' ? 'AND (op.person_id IS NULL OR op.person_id=p.id)' : ''}
    ${section ? 'ORDER BY 1,2' : 'RETURNING id'}`,
    )
    .bind(...values);
}
export function exportQueries(
  db: Db,
  personId: string,
  authority: PersonExportAuthority,
  at: string,
) {
  return (Object.keys(QUERIES) as PersonExportSection[]).map((section) => ({
    section,
    statement: exportStatement(db, { personId, authority, at }, section),
  }));
}
