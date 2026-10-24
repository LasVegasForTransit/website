import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import { INTERESTS, type Interest } from '@lasvegasfortransit/platform-core/join-form';
import type { MembershipStatus } from '@lasvegasfortransit/platform-core/membership';
import type { Db } from './db';

function interestIds(json: string): Interest[] {
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed)
    ? parsed.filter((value): value is Interest => INTERESTS.some((interest) => interest === value))
    : [];
}
export async function loadActor(db: Db, personId: string): Promise<Actor | null> {
  const person = await db
    .prepare(
      `SELECT p.membership_status,
    EXISTS(SELECT 1 FROM identities WHERE person_id=p.id AND platform='google_workspace') AS workspace_linked,
    EXISTS(SELECT 1 FROM staff_sso_links WHERE person_id=p.id AND revoked_at IS NULL) AS sso_linked,
    EXISTS(SELECT 1 FROM staff_team_accounts WHERE person_id=p.id) AS team_account,
    EXISTS(SELECT 1 FROM staff_administrators WHERE person_id=p.id) AS staff_admin
    FROM people p WHERE p.id=? AND p.deleted_at IS NULL`,
    )
    .bind(personId)
    .first<{
      membership_status: MembershipStatus;
      workspace_linked: number;
      sso_linked: number;
      staff_admin: number;
      team_account: number;
    }>();
  if (!person) return null;
  const { results } = await db
    .prepare(
      `SELECT c.id,a.role,c.interest_ids FROM committee_assignments a
    JOIN committees c ON c.id=a.committee_id WHERE a.person_id=? AND a.ended_at IS NULL`,
    )
    .bind(personId)
    .all<{ id: string; role: 'member' | 'lead'; interest_ids: string }>();
  return {
    personId,
    membershipStatus: person.membership_status,
    workspaceLinked: Boolean(person.workspace_linked),
    organizationAuthenticated: Boolean(person.workspace_linked || person.sso_linked),
    staffAdmin: Boolean(person.staff_admin),
    teamAccount: Boolean(person.team_account),
    committees: results.map((row) => ({
      id: row.id,
      role: row.role,
      interestIds: interestIds(row.interest_ids),
    })),
    eventsLed: [],
  };
}
