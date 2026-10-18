import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Actor, MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import { STAFF_ADMIN_SCOPE, STAFF_PERSON_SCOPE } from './staff-scope';
import { auditDenied } from './audits';
import {
  mutateOrganizationRole,
  organizationRoleAdministrator,
  validRoleId,
  ROLE_COLUMNS,
  ROLE_RESULT,
  type OrganizationRole,
  type PersonOrganizationRole,
} from './organization-role-store';
export type { OrganizationRole, PersonOrganizationRole } from './organization-role-store';

function roleName(value: string): string | null {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return null;
  const name = value.normalize('NFC').trim().replaceAll(/\s+/gu, ' ');
  return name.length > 0 && name.length <= 100 ? name : null;
}
export async function listOrganizationRoles(
  db: Db,
  actor: Actor,
  query: { includeRetired?: boolean } = {},
): Promise<OrganizationRole[]> {
  if (!(await organizationRoleAdministrator(db, actor.personId))) {
    await auditDenied(db, actor.personId, 'person.update');
    throw new PermissionDenied('person.update');
  }
  const { results } = await db
    .prepare(
      `SELECT ${ROLE_COLUMNS} FROM organization_roles WHERE ${STAFF_ADMIN_SCOPE} AND (? OR retired_at IS NULL) ORDER BY name_key,id`,
    )
    .bind(actor.personId, Number(!!query.includeRetired))
    .all<OrganizationRole>();
  return results;
}
export async function listPersonOrganizationRoles(
  db: Db,
  actor: Actor,
  personId: string,
): Promise<PersonOrganizationRole[]> {
  const allowed = () =>
    db
      .prepare(
        `SELECT 1 FROM people p WHERE p.id=? AND p.deleted_at IS NULL AND ${STAFF_PERSON_SCOPE}`,
      )
      .bind(personId, actor.personId)
      .first();
  if (!(await allowed())) {
    await auditDenied(db, actor.personId, 'person.view');
    throw new PermissionDenied('person.view');
  }
  const { results } = await db
    .prepare(
      `SELECT a.id,a.role_id AS roleId,r.name,a.assigned_at AS assignedAt,r.retired_at AS retiredAt FROM person_organization_roles a JOIN organization_roles r ON r.id=a.role_id JOIN people p ON p.id=a.person_id WHERE p.id=? AND p.deleted_at IS NULL AND a.ended_at IS NULL AND ${STAFF_PERSON_SCOPE} ORDER BY r.name_key,a.id`,
    )
    .bind(personId, actor.personId)
    .all<PersonOrganizationRole>();
  return (await allowed()) ? results : [];
}
export async function defineOrganizationRole(
  db: Db,
  actor: Actor,
  input: { name: string; operationId: string },
): Promise<MutationResult<OrganizationRole>> {
  const name = roleName(input.name);
  if (!name) return { kind: 'invalid' };
  const id = ulid(),
    stamp = new Date().toISOString(),
    nameKey = name.toLocaleLowerCase('en');
  return mutateOrganizationRole(db, actor, {
    kind: 'organization_role.define',
    targetId: 'organization-role-catalog',
    auditTargetId: id,
    operationId: input.operationId,
    payload: JSON.stringify({ name }),
    stamp,
    guard: 'NOT EXISTS(SELECT 1 FROM organization_roles WHERE name_key=?)',
    guardValues: [nameKey],
    write:
      'INSERT INTO organization_roles(id,name,name_key,created_at,updated_at) SELECT ?,?,?,?,? WHERE %FENCE%',
    writeValues: [id, name, nameKey, stamp, stamp],
    result: ROLE_RESULT,
    resultValues: [id],
  });
}
export async function renameOrganizationRole(
  db: Db,
  actor: Actor,
  input: { roleId: string; name: string; operationId: string },
): Promise<MutationResult<OrganizationRole>> {
  const name = roleName(input.name);
  if (!name || !validRoleId(input.roleId)) return { kind: 'invalid' };
  const stamp = new Date().toISOString(),
    nameKey = name.toLocaleLowerCase('en');
  return mutateOrganizationRole(db, actor, {
    kind: 'organization_role.rename',
    targetId: input.roleId,
    operationId: input.operationId,
    payload: JSON.stringify({ name }),
    stamp,
    guard:
      'EXISTS(SELECT 1 FROM organization_roles WHERE id=?) AND NOT EXISTS(SELECT 1 FROM organization_roles WHERE name_key=? AND id<>?)',
    guardValues: [input.roleId, nameKey, input.roleId],
    write: 'UPDATE organization_roles SET name=?,name_key=?,updated_at=? WHERE id=? AND %FENCE%',
    writeValues: [name, nameKey, stamp, input.roleId],
    result: ROLE_RESULT,
    resultValues: [input.roleId],
  });
}
export async function retireOrganizationRole(
  db: Db,
  actor: Actor,
  input: { roleId: string; operationId: string },
): Promise<MutationResult<OrganizationRole>> {
  if (!validRoleId(input.roleId)) return { kind: 'invalid' };
  const stamp = new Date().toISOString();
  return mutateOrganizationRole(db, actor, {
    kind: 'organization_role.retire',
    targetId: input.roleId,
    operationId: input.operationId,
    payload: '{}',
    stamp,
    guard: 'EXISTS(SELECT 1 FROM organization_roles WHERE id=?)',
    guardValues: [input.roleId],
    write:
      'UPDATE organization_roles SET retired_at=coalesce(retired_at,?),updated_at=? WHERE id=? AND %FENCE%',
    writeValues: [stamp, stamp, input.roleId],
    result: ROLE_RESULT,
    resultValues: [input.roleId],
  });
}
interface PersonRoleInput {
  personId: string;
  roleId: string;
  operationId: string;
}
function personRoleMutation(
  db: Db,
  actor: Actor,
  input: PersonRoleInput,
  assign: boolean,
): Promise<MutationResult<{ personId: string; roleId: string }>> {
  if (!validRoleId(input.personId) || !validRoleId(input.roleId))
    return Promise.resolve({ kind: 'invalid' });
  const stamp = new Date().toISOString();
  const active =
    'SELECT 1 FROM person_organization_roles WHERE person_id=? AND role_id=? AND ended_at IS NULL';
  return mutateOrganizationRole(db, actor, {
    kind: assign ? 'organization_role.assign' : 'organization_role.remove',
    targetId: input.personId,
    operationId: input.operationId,
    payload: JSON.stringify({ roleId: input.roleId }),
    stamp,
    guard: `EXISTS(SELECT 1 FROM people WHERE id=? AND deleted_at IS NULL ${assign ? "AND membership_status='member'" : ''}) AND EXISTS(SELECT 1 FROM organization_roles WHERE id=? ${assign ? 'AND retired_at IS NULL' : ''}) AND ${assign ? 'NOT' : ''} EXISTS(${active})`,
    guardValues: [input.personId, input.roleId, input.personId, input.roleId],
    write: assign
      ? 'INSERT INTO person_organization_roles(id,person_id,role_id,assigned_at,assigned_by,updated_at) SELECT ?,?,?,?,?,? WHERE %FENCE%'
      : 'UPDATE person_organization_roles SET ended_at=?,ended_by=?,updated_at=? WHERE person_id=? AND role_id=? AND ended_at IS NULL AND %FENCE%',
    writeValues: assign
      ? [ulid(), input.personId, input.roleId, stamp, actor.personId, stamp]
      : [stamp, actor.personId, stamp, input.personId, input.roleId],
    result: "SELECT json_object('personId',?,'roleId',?)",
    resultValues: [input.personId, input.roleId],
  });
}
export async function assignOrganizationRole(db: Db, actor: Actor, input: PersonRoleInput) {
  return personRoleMutation(db, actor, input, true);
}
export async function removeOrganizationRole(db: Db, actor: Actor, input: PersonRoleInput) {
  return personRoleMutation(db, actor, input, false);
}
