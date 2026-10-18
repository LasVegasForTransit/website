import type { Actor, MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import { INTERESTS, type Interest } from '@lasvegasfortransit/platform-core/join-form';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { MembershipStatus } from '@lasvegasfortransit/platform-core/membership';
import type { Db, SqlValue } from './db';
import { auditDenied } from './audits';
import { ADMINISTRATOR_WORKSPACE_IDENTITY } from './staff-administrators';
import { can } from '@lasvegasfortransit/platform-core/permissions';

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
    EXISTS(SELECT 1 FROM staff_administrators WHERE person_id=p.id) AS staff_admin
    FROM people p WHERE p.id=? AND p.deleted_at IS NULL`,
    )
    .bind(personId)
    .first<{
      membership_status: MembershipStatus;
      workspace_linked: number;
      staff_admin: number;
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
    staffAdmin: Boolean(person.staff_admin),
    committees: results.map((row) => ({
      id: row.id,
      role: row.role,
      interestIds: interestIds(row.interest_ids),
    })),
    eventsLed: [],
  };
}

const ACTIVE_ADMIN = `EXISTS (SELECT 1 FROM staff_administrators a JOIN people p ON p.id=a.person_id AND p.deleted_at IS NULL AND p.membership_status='member' WHERE a.person_id=?)`;

export async function bootstrapStaffAdmin(
  db: Db,
  input: {
    presidentPersonId: string;
    workspaceSubject: string;
    performedBy: string;
    operationId: string;
  },
): Promise<MutationResult<{ personId: string }>> {
  if (!input.performedBy.trim() || !input.operationId || !input.workspaceSubject)
    return { kind: 'invalid' };
  const linked = await db
    .prepare(
      `SELECT i.person_id FROM identities i JOIN people p ON p.id=i.person_id AND p.deleted_at IS NULL AND p.membership_status='member'
    WHERE i.platform='google_workspace' AND i.external_id=? AND i.person_id=?`,
    )
    .bind(input.workspaceSubject, input.presidentPersonId)
    .first();
  if (!linked) return { kind: 'invalid' };
  const payload = JSON.stringify({
    workspaceSubject: input.workspaceSubject,
    performedBy: input.performedBy,
  });
  const stamp = new Date().toISOString();
  await db.batch(bootstrapWrites(db, input, { payload, stamp }));
  const receipt = await db
    .prepare(
      `SELECT 1 AS applied FROM staff_operations WHERE operation_id=? AND kind='staff_admin.bootstrap'
    AND target_id=? AND payload=? AND applied_at IS NOT NULL`,
    )
    .bind(input.operationId, input.presidentPersonId, payload)
    .first();
  return receipt
    ? { kind: 'ok', value: { personId: input.presidentPersonId } }
    : { kind: 'conflict' };
}

function bootstrapWrites(
  db: Db,
  input: Parameters<typeof bootstrapStaffAdmin>[1],
  context: { payload: string; stamp: string },
) {
  const { payload, stamp } = context;
  return [
    db
      .prepare(
        `INSERT INTO staff_operations (operation_id,actor_id,kind,target_id,payload,created_at)
      SELECT ?,?,'staff_admin.bootstrap',?,?,? WHERE NOT EXISTS (SELECT 1 FROM staff_administrators)
      AND EXISTS (SELECT 1 FROM identities i JOIN people p ON p.id=i.person_id AND p.deleted_at IS NULL AND p.membership_status='member'
        WHERE i.platform='google_workspace' AND i.external_id=? AND i.person_id=?) ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(
        input.operationId,
        input.presidentPersonId,
        input.presidentPersonId,
        payload,
        stamp,
        input.workspaceSubject,
        input.presidentPersonId,
      ),
    db
      .prepare(
        `INSERT INTO staff_administrators (person_id,designated_by,designated_at)
      SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=?
        AND kind='staff_admin.bootstrap' AND payload=? AND applied_at IS NULL) ON CONFLICT(person_id) DO NOTHING`,
      )
      .bind(
        input.presidentPersonId,
        input.performedBy,
        stamp,
        input.operationId,
        input.presidentPersonId,
        input.presidentPersonId,
        payload,
      ),
    db
      .prepare(
        `INSERT INTO staff_audits (id,actor_id,action,target_id,details,operation_id,occurred_at)
      SELECT ?,?,'staff_admin.bootstrap',?,?,?,? WHERE EXISTS (SELECT 1 FROM staff_operations
        WHERE operation_id=? AND kind='staff_admin.bootstrap' AND payload=? AND applied_at IS NULL)
        AND EXISTS (SELECT 1 FROM staff_administrators WHERE person_id=?) ON CONFLICT(operation_id,action) WHERE operation_id IS NOT NULL DO NOTHING`,
      )
      .bind(
        ulid(),
        input.presidentPersonId,
        input.presidentPersonId,
        payload,
        input.operationId,
        stamp,
        input.operationId,
        payload,
        input.presidentPersonId,
      ),
    db
      .prepare(
        `UPDATE staff_operations SET applied_at=?,result=? WHERE operation_id=? AND actor_id=? AND target_id=?
      AND kind='staff_admin.bootstrap' AND payload=? AND EXISTS(SELECT 1 FROM staff_administrators WHERE person_id=?)`,
      )
      .bind(
        stamp,
        JSON.stringify({ personId: input.presidentPersonId }),
        input.operationId,
        input.presidentPersonId,
        input.presidentPersonId,
        payload,
        input.presidentPersonId,
      ),
  ];
}

export interface StaffAdminManageInput {
  targetPersonId: string;
  enabled: boolean;
  operationId: string;
  expectedState?: { updatedAt: string; designatedAt: string | null };
  /** Trusted server policy for portal grants; legacy maintenance callers retain their existing contract. */
  requireWorkspaceIdentity?: boolean;
}
interface AdministratorTarget {
  updated_at: string;
  membership_status: MembershipStatus;
  designated_at: string | null;
  has_workspace: number;
  has_other_active: number;
}
interface AdministratorChange extends StaffAdminManageInput {
  actorId: string;
  target: AdministratorTarget;
  payload: string;
  stamp: string;
}
const FRESH_ADMIN_CHANGE = `EXISTS(SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=?
  AND target_id=? AND payload=? AND kind='staff_admin.manage' AND applied_at IS NULL)`;
const OTHER_ACTIVE_ADMIN = `EXISTS(SELECT 1 FROM staff_administrators other JOIN people active ON active.id=other.person_id
  WHERE active.deleted_at IS NULL AND active.membership_status='member' AND other.person_id<>p.id)`;
async function administratorTarget(db: Db, id: string): Promise<AdministratorTarget | null> {
  return await db
    .prepare(
      `SELECT p.updated_at,p.membership_status,a.designated_at,
    ${ADMINISTRATOR_WORKSPACE_IDENTITY} AS has_workspace,
    ${OTHER_ACTIVE_ADMIN} AS has_other_active FROM people p LEFT JOIN staff_administrators a ON a.person_id=p.id
    WHERE p.id=? AND p.deleted_at IS NULL`,
    )
    .bind(id)
    .first<AdministratorTarget>();
}
function keepsActiveAdministrator(target: AdministratorTarget): boolean {
  return (
    target.designated_at === null ||
    target.membership_status !== 'member' ||
    Boolean(target.has_other_active)
  );
}
function validManagementInput(input: StaffAdminManageInput): boolean {
  if (
    !input.operationId.trim() ||
    input.operationId.length > 200 ||
    typeof input.enabled !== 'boolean'
  )
    return false;
  if (!input.expectedState) return true;
  return (
    Number.isFinite(Date.parse(input.expectedState.updatedAt)) &&
    (input.expectedState.designatedAt === null ||
      Number.isFinite(Date.parse(input.expectedState.designatedAt)))
  );
}
function selectedStateMatches(target: AdministratorTarget, input: StaffAdminManageInput): boolean {
  return (
    !input.expectedState ||
    (target.updated_at === input.expectedState.updatedAt &&
      target.designated_at === input.expectedState.designatedAt)
  );
}
function managementPayload(input: StaffAdminManageInput): string {
  return JSON.stringify({
    enabled: input.enabled,
    ...(input.expectedState ? { expectedState: input.expectedState } : {}),
    ...(input.requireWorkspaceIdentity ? { requireWorkspaceIdentity: true } : {}),
  });
}
async function managementRejection(
  db: Db,
  actor: Actor,
  input: StaffAdminManageInput,
): Promise<MutationResult<{ enabled: boolean }>> {
  const current = await loadActor(db, actor.personId);
  if (!current || !can(current, 'staff_admin.manage')) return { kind: 'forbidden' };
  const target = await administratorTarget(db, input.targetPersonId);
  if (!target) return { kind: 'not_found' };
  return { kind: !input.enabled && !keepsActiveAdministrator(target) ? 'last_admin' : 'conflict' };
}
async function managementReplay(
  db: Db,
  actorId: string,
  input: StaffAdminManageInput,
  payload: string,
): Promise<MutationResult<{ enabled: boolean }> | null> {
  const prior = await db
    .prepare(
      'SELECT actor_id,kind,target_id,payload,applied_at FROM staff_operations WHERE operation_id=?',
    )
    .bind(input.operationId)
    .first<{
      actor_id: string;
      kind: string;
      target_id: string;
      payload: string;
      applied_at: string | null;
    }>();
  if (!prior) return null;
  return prior.actor_id === actorId &&
    prior.kind === 'staff_admin.manage' &&
    prior.target_id === input.targetPersonId &&
    prior.payload === payload &&
    prior.applied_at
    ? { kind: 'ok', value: { enabled: input.enabled } }
    : { kind: 'conflict' };
}
function targetRejection(
  target: AdministratorTarget,
  input: StaffAdminManageInput,
): MutationResult<{ enabled: boolean }> | null {
  if (!selectedStateMatches(target, input)) return { kind: 'conflict' };
  if (
    input.enabled &&
    (target.membership_status !== 'member' ||
      (input.requireWorkspaceIdentity && !target.has_workspace))
  )
    return { kind: 'invalid' };
  return !input.enabled && !keepsActiveAdministrator(target) ? { kind: 'last_admin' } : null;
}
export async function staffAdminManage(
  db: Db,
  actor: Actor,
  input: StaffAdminManageInput,
): Promise<MutationResult<{ enabled: boolean }>> {
  const current = await loadActor(db, actor.personId);
  if (!current || !can(current, 'staff_admin.manage')) {
    await auditDenied(db, actor.personId, 'staff_admin.manage');
    return { kind: 'forbidden' };
  }
  if (!validManagementInput(input)) return { kind: 'invalid' };
  const payload = managementPayload(input);
  const prior = await managementReplay(db, actor.personId, input, payload);
  if (prior) return prior;
  const target = await administratorTarget(db, input.targetPersonId);
  if (!target) return { kind: 'not_found' };
  const rejection = targetRejection(target, input);
  if (rejection) return rejection;
  const change = {
    ...input,
    actorId: actor.personId,
    target,
    payload,
    stamp: new Date().toISOString(),
  };
  try {
    await db.batch(administratorWrites(db, change));
  } catch (error) {
    if (error instanceof Error && error.message.includes('last_staff_administrator'))
      return { kind: 'last_admin' };
    throw error;
  }
  const result = await db
    .prepare(
      `SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=?
    AND kind='staff_admin.manage' AND payload=? AND applied_at IS NOT NULL`,
    )
    .bind(input.operationId, actor.personId, input.targetPersonId, payload)
    .first();
  return result
    ? { kind: 'ok', value: { enabled: input.enabled } }
    : await managementRejection(db, actor, input);
}
function freshAdminValues(input: AdministratorChange): SqlValue[] {
  return [input.operationId, input.actorId, input.targetPersonId, input.payload];
}
function targetGuard(input: AdministratorChange): { sql: string; values: SqlValue[] } {
  const member = input.enabled ? "AND p.membership_status='member'" : '';
  const workspace =
    input.enabled && input.requireWorkspaceIdentity
      ? `AND ${ADMINISTRATOR_WORKSPACE_IDENTITY}`
      : '';
  const keep = input.enabled
    ? ''
    : `AND (p.membership_status<>'member' OR NOT EXISTS(SELECT 1 FROM staff_administrators WHERE person_id=p.id) OR ${OTHER_ACTIVE_ADMIN})`;
  return {
    sql: `EXISTS(SELECT 1 FROM people p WHERE p.id=? AND p.deleted_at IS NULL AND p.updated_at=?
    AND (SELECT designated_at FROM staff_administrators WHERE person_id=p.id) IS ? ${member} ${workspace} ${keep})`,
    values: [input.targetPersonId, input.target.updated_at, input.target.designated_at],
  };
}
function designationChange(db: Db, input: AdministratorChange) {
  const target = targetGuard(input);
  const guard = `${FRESH_ADMIN_CHANGE} AND ${ACTIVE_ADMIN} AND ${target.sql}`;
  const values = [...freshAdminValues(input), input.actorId, ...target.values];
  return input.enabled
    ? db
        .prepare(
          `INSERT INTO staff_administrators(person_id,designated_by,designated_at) SELECT ?,?,? WHERE ${guard} ON CONFLICT(person_id) DO NOTHING`,
        )
        .bind(input.targetPersonId, input.actorId, input.stamp, ...values)
    : db
        .prepare(`DELETE FROM staff_administrators WHERE person_id=? AND ${guard}`)
        .bind(input.targetPersonId, ...values);
}
function administratorWrites(db: Db, input: AdministratorChange) {
  const target = targetGuard(input);
  const desired = input.enabled
    ? 'EXISTS(SELECT 1 FROM staff_administrators WHERE person_id=?)'
    : 'NOT EXISTS(SELECT 1 FROM staff_administrators WHERE person_id=?)';
  return [
    db
      .prepare(
        `INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,created_at)
      SELECT ?,?,'staff_admin.manage',?,?,? WHERE ${ACTIVE_ADMIN} AND ${target.sql} ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(
        input.operationId,
        input.actorId,
        input.targetPersonId,
        input.payload,
        input.stamp,
        input.actorId,
        ...target.values,
      ),
    designationChange(db, input),
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at)
      SELECT ?,?,'staff_admin.manage',?,?,?,? WHERE ${FRESH_ADMIN_CHANGE} AND ${desired}
      ON CONFLICT(operation_id,action) WHERE operation_id IS NOT NULL DO NOTHING`,
      )
      .bind(
        ulid(),
        input.actorId,
        input.targetPersonId,
        input.payload,
        input.operationId,
        input.stamp,
        ...freshAdminValues(input),
        input.targetPersonId,
      ),
    db
      .prepare(
        `UPDATE staff_operations SET result=?,applied_at=? WHERE ${FRESH_ADMIN_CHANGE}
      AND EXISTS(SELECT 1 FROM staff_audits WHERE operation_id=? AND action='staff_admin.manage')`,
      )
      .bind(input.payload, input.stamp, ...freshAdminValues(input), input.operationId),
  ];
}
