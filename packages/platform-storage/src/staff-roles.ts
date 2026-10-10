import type { Actor, MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import { INTERESTS, type Interest } from '@lasvegasfortransit/platform-core/join-form';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { MembershipStatus } from '@lasvegasfortransit/platform-core/membership';
import type { Db } from './db';
import { auditDenied } from './audits';
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

export async function staffAdminManage(
  db: Db,
  actor: Actor,
  input: { targetPersonId: string; enabled: boolean; operationId: string },
): Promise<MutationResult<{ enabled: boolean }>> {
  const { targetPersonId, enabled, operationId } = input;
  const current = await loadActor(db, actor.personId);
  if (!current || !can(current, 'staff_admin.manage')) {
    await auditDenied(db, actor.personId, 'staff_admin.manage');
    return { kind: 'forbidden' };
  }
  if (!operationId) return { kind: 'invalid' };
  const payload = JSON.stringify({ enabled });
  const stamp = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO staff_operations (operation_id,actor_id,kind,target_id,payload,created_at)
        SELECT ?,?,'staff_admin.manage',?,?,? WHERE ${ACTIVE_ADMIN} AND EXISTS(SELECT 1 FROM people WHERE id=? AND deleted_at IS NULL)
        ON CONFLICT(operation_id) DO NOTHING`,
        )
        .bind(
          operationId,
          actor.personId,
          targetPersonId,
          payload,
          stamp,
          actor.personId,
          targetPersonId,
        ),
      designationChange(db, {
        actorId: actor.personId,
        targetPersonId,
        enabled,
        operationId,
        payload,
        stamp,
      }),
      db
        .prepare(
          `INSERT INTO staff_audits (id,actor_id,action,target_id,details,operation_id,occurred_at)
        SELECT ?,?,'staff_admin.manage',?,?,?,? WHERE EXISTS (SELECT 1 FROM staff_operations WHERE operation_id=?
          AND actor_id=? AND target_id=? AND payload=? AND applied_at IS NULL)
        ON CONFLICT(operation_id,action) WHERE operation_id IS NOT NULL DO NOTHING`,
        )
        .bind(
          ulid(),
          actor.personId,
          targetPersonId,
          payload,
          operationId,
          stamp,
          operationId,
          actor.personId,
          targetPersonId,
          payload,
        ),
      db
        .prepare(
          `UPDATE staff_operations SET result=?,applied_at=? WHERE operation_id=? AND actor_id=? AND target_id=? AND payload=?
        AND kind='staff_admin.manage' AND applied_at IS NULL AND EXISTS (SELECT 1 FROM staff_audits WHERE operation_id=? AND action='staff_admin.manage')`,
        )
        .bind(payload, stamp, operationId, actor.personId, targetPersonId, payload, operationId),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes('last_staff_administrator'))
      return { kind: 'last_admin' };
    throw error;
  }
  const result = await db
    .prepare(
      `SELECT result FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=?
    AND kind='staff_admin.manage' AND payload=? AND applied_at IS NOT NULL`,
    )
    .bind(operationId, actor.personId, targetPersonId, payload)
    .first();
  return result ? { kind: 'ok', value: { enabled } } : { kind: 'forbidden' };
}

function designationChange(
  db: Db,
  input: {
    actorId: string;
    targetPersonId: string;
    enabled: boolean;
    operationId: string;
    payload: string;
    stamp: string;
  },
) {
  const fresh = `EXISTS (SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=? AND payload=? AND kind='staff_admin.manage' AND applied_at IS NULL)`;
  const guard = `${fresh} AND ${ACTIVE_ADMIN}`;
  return input.enabled
    ? db
        .prepare(
          `INSERT INTO staff_administrators (person_id,designated_by,designated_at) SELECT ?,?,? WHERE ${guard} ON CONFLICT(person_id) DO NOTHING`,
        )
        .bind(
          input.targetPersonId,
          input.actorId,
          input.stamp,
          input.operationId,
          input.actorId,
          input.targetPersonId,
          input.payload,
          input.actorId,
        )
    : db
        .prepare(`DELETE FROM staff_administrators WHERE person_id=? AND ${guard}`)
        .bind(
          input.targetPersonId,
          input.operationId,
          input.actorId,
          input.targetPersonId,
          input.payload,
          input.actorId,
        );
}
