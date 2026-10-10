import type { Actor, Page } from '@lasvegasfortransit/platform-core/staff-types';
import type { MembershipStatus } from '@lasvegasfortransit/platform-core/membership';
import type { Interest } from '@lasvegasfortransit/platform-core/join-form';
import type { Db } from './db';
import { STAFF_PERSON_SCOPE } from './staff-scope';
import { auditDenied } from './audits';
import { validatePersonCursor } from './staff-history';
export const COMMITTEE_SCOPE = `EXISTS(SELECT 1 FROM people viewer WHERE viewer.id=? AND viewer.deleted_at IS NULL AND viewer.membership_status='member'
 AND (EXISTS(SELECT 1 FROM staff_administrators WHERE person_id=viewer.id)
 OR EXISTS(SELECT 1 FROM committee_assignments lead WHERE lead.person_id=viewer.id AND lead.committee_id=c.id AND lead.role='lead' AND lead.ended_at IS NULL)))`;
export interface CommitteeSettings {
  id: string;
  name: string;
  description: string;
  timeCommitment: string;
  acceptingMembers: boolean;
  settingsVersion: number;
  workspaceGroupEmail: string | null;
  discordRoleId: string | null;
  interestIds: Interest[];
}
interface CommitteeRow {
  id: string;
  name: string;
  description: string;
  time_commitment: string;
  accepting_members: number;
  settings_version: number;
  workspace_group_email: string | null;
  discord_role_id: string | null;
  interest_ids: string;
  people_count: number;
  lead_names: string;
}
export interface CommitteeSummary extends CommitteeSettings {
  peopleCount: number;
  leadNames: string[];
}
export function committeeSettings(row: CommitteeRow): CommitteeSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    timeCommitment: row.time_commitment,
    acceptingMembers: Boolean(row.accepting_members),
    settingsVersion: row.settings_version,
    workspaceGroupEmail: row.workspace_group_email,
    discordRoleId: row.discord_role_id,
    interestIds: JSON.parse(row.interest_ids) as Interest[],
    peopleCount: row.people_count,
    leadNames: JSON.parse(row.lead_names) as string[],
  };
}
const SUMMARY = `c.*,
 (SELECT count(*) FROM committee_assignments a JOIN people p ON p.id=a.person_id AND p.deleted_at IS NULL WHERE a.committee_id=c.id AND a.ended_at IS NULL) AS people_count,
 (SELECT json_group_array(name) FROM (SELECT coalesce(nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),''),p.email,'Name not recorded') AS name FROM committee_assignments a JOIN people p ON p.id=a.person_id AND p.deleted_at IS NULL WHERE a.committee_id=c.id AND a.ended_at IS NULL AND a.role='lead' AND p.membership_status='member' ORDER BY name,a.id)) AS lead_names`;
export async function listCommittees(db: Db, actor: Actor): Promise<CommitteeSummary[]> {
  const { results } = await db
    .prepare(`SELECT ${SUMMARY} FROM committees c WHERE ${COMMITTEE_SCOPE} ORDER BY c.name`)
    .bind(actor.personId)
    .all<CommitteeRow>();
  return results.map(committeeSettings);
}
export interface CommitteePerson {
  assignmentId: string;
  personId: string;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  membershipStatus: MembershipStatus;
  role: 'member' | 'lead';
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  accountUpdateState: string | null;
}
async function roster(
  db: Db,
  actor: Actor,
  committeeId: string,
  input: { past: boolean; cursor?: string | undefined; limit?: number | undefined },
): Promise<Page<CommitteePerson>> {
  if (input.cursor) validatePersonCursor(input.cursor);
  const limit = Number.isFinite(input.limit)
    ? Math.max(1, Math.min(100, Math.floor(input.limit ?? 25)))
    : 25;
  const { results } = await db
    .prepare(
      `SELECT a.id AS assignmentId,p.id AS personId,p.given_name AS givenName,p.family_name AS familyName,p.email,p.membership_status AS membershipStatus,
    a.role,a.started_at AS startedAt,a.ended_at AS endedAt,a.end_reason AS endReason,
    (SELECT o.state FROM integration_outbox o JOIN reconcile_generations g ON g.person_id=o.person_id AND g.target_id=o.target_id AND g.generation=o.generation WHERE o.person_id=p.id AND o.target_id=c.id AND o.kind='committee_reconcile' ORDER BY o.created_at DESC,o.id DESC LIMIT 1) AS accountUpdateState
    FROM committee_assignments a JOIN committees c ON c.id=a.committee_id JOIN people p ON p.id=a.person_id AND p.deleted_at IS NULL
    WHERE c.id=? AND ${COMMITTEE_SCOPE} AND ${STAFF_PERSON_SCOPE} AND a.ended_at IS ${input.past ? 'NOT' : ''} NULL ${input.cursor ? 'AND a.id>?' : ''} ORDER BY a.id LIMIT ?`,
    )
    .bind(
      committeeId,
      actor.personId,
      actor.personId,
      ...(input.cursor ? [input.cursor] : []),
      limit + 1,
    )
    .all<CommitteePerson>();
  const items = results.slice(0, limit);
  return {
    items,
    nextCursor: results.length > limit ? (items.at(-1)?.assignmentId ?? null) : null,
  };
}
export async function getCommitteeView(
  db: Db,
  actor: Actor,
  committeeId: string,
  input: { cursor?: string; pastCursor?: string; limit?: number } = {},
) {
  const row = await db
    .prepare(`SELECT ${SUMMARY} FROM committees c WHERE c.id=? AND ${COMMITTEE_SCOPE}`)
    .bind(committeeId, actor.personId)
    .first<CommitteeRow>();
  if (!row) {
    await auditDenied(db, actor.personId, 'committee.view');
    return null;
  }
  const [current, past] = await Promise.all([
    roster(db, actor, committeeId, { past: false, cursor: input.cursor, limit: input.limit }),
    roster(db, actor, committeeId, { past: true, cursor: input.pastCursor, limit: input.limit }),
  ]);
  const stillVisible = await db
    .prepare(`SELECT 1 FROM committees c WHERE c.id=? AND ${COMMITTEE_SCOPE}`)
    .bind(committeeId, actor.personId)
    .first();
  if (!stillVisible) {
    await auditDenied(db, actor.personId, 'committee.view');
    return null;
  }
  return { committee: committeeSettings(row), current, past };
}
