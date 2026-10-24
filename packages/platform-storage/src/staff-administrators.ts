import { WORKSPACE_DOMAIN } from '@lasvegasfortransit/platform-core/workspace-identity';
import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { MembershipStatus } from '@lasvegasfortransit/platform-core/membership';
import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditDenied } from './audits';
import { peopleFilters } from './people-search';
import { ROSTER_NAME } from './staff-roster-cursor';

export interface StaffAdministratorPerson {
  id: string;
  given_name: string | null;
  family_name: string | null;
  email: string | null;
  membership_status: MembershipStatus;
  updated_at: string;
  designated_at: string | null;
  has_workspace: number;
  has_organization_auth: number;
}
export const ADMINISTRATOR_WORKSPACE_IDENTITY = `EXISTS(SELECT 1 FROM identities WHERE person_id=p.id
  AND platform='google_workspace' AND external_id<>'' AND lower(external_email) LIKE '%@${WORKSPACE_DOMAIN}')`;
export const ADMINISTRATOR_AUTHENTICATED_IDENTITY = `(${ADMINISTRATOR_WORKSPACE_IDENTITY} OR EXISTS(SELECT 1 FROM staff_sso_links WHERE person_id=p.id AND revoked_at IS NULL))`;
const COLUMNS = `p.id,p.given_name,p.family_name,p.email,p.membership_status,p.updated_at,a.designated_at,
  ${ADMINISTRATOR_WORKSPACE_IDENTITY} AS has_workspace,${ADMINISTRATOR_AUTHENTICATED_IDENTITY} AS has_organization_auth`;
async function requireAdministrator(db: Db, actor: Actor): Promise<void> {
  if (await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actor.personId).first()) return;
  await auditDenied(db, actor.personId, 'staff_admin.manage');
  throw new PermissionDenied('staff_admin.manage');
}
export async function listStaffAdministrators(
  db: Db,
  actor: Actor,
): Promise<StaffAdministratorPerson[]> {
  await requireAdministrator(db, actor);
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM people p JOIN staff_administrators a ON a.person_id=p.id
    WHERE p.deleted_at IS NULL AND ${STAFF_ADMIN_SCOPE} ORDER BY ${ROSTER_NAME},p.id`,
    )
    .bind(actor.personId)
    .all<StaffAdministratorPerson>();
  await requireAdministrator(db, actor);
  return results;
}
export async function searchStaffAdministratorCandidates(
  db: Db,
  actor: Actor,
  query: string,
): Promise<StaffAdministratorPerson[]> {
  await requireAdministrator(db, actor);
  const text = query.trim();
  if (!text || text.length > 254) return [];
  const { where, values } = peopleFilters({ text, membershipStatus: 'member' }, 'p.');
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM people p LEFT JOIN staff_administrators a ON a.person_id=p.id
    WHERE ${where.join(' AND ')} AND ${STAFF_ADMIN_SCOPE} ORDER BY ${ROSTER_NAME},p.id LIMIT 25`,
    )
    .bind(...values, actor.personId)
    .all<StaffAdministratorPerson>();
  await requireAdministrator(db, actor);
  return results;
}
export async function staffAdministratorView(
  db: Db,
  actor: Actor,
  id: string,
): Promise<StaffAdministratorPerson | null> {
  await requireAdministrator(db, actor);
  const row = await db
    .prepare(
      `SELECT ${COLUMNS} FROM people p LEFT JOIN staff_administrators a ON a.person_id=p.id
    WHERE p.id=? AND p.deleted_at IS NULL AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(id, actor.personId)
    .first<StaffAdministratorPerson>();
  await requireAdministrator(db, actor);
  return row;
}
