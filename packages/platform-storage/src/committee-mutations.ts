import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db, Statement } from './db';
import { WELCOME_SCOPE } from './welcome-scope';
import {
  assignment,
  type Assignment,
  type AssignmentEndReason,
  type AssignmentRole,
  type AssignmentRow,
} from './committees';
export interface AssignmentMutation {
  kind: 'assign' | 'change' | 'end';
  id: string;
  personId: string;
  committeeId: string;
  role: AssignmentRole;
  reason?: AssignmentEndReason;
  actorId: string;
  operationId: string;
  fromWelcome?: true;
  administratorsOnly?: true;
}
interface MutationContext extends AssignmentMutation {
  payload: string;
  stamp: string;
}
const AUTHORITY = `EXISTS (SELECT 1 FROM people p WHERE p.id=? AND p.deleted_at IS NULL AND p.membership_status='member' AND
  (EXISTS (SELECT 1 FROM staff_administrators WHERE person_id=p.id) OR
   EXISTS (SELECT 1 FROM committee_assignments WHERE person_id=p.id AND committee_id=? AND role='lead' AND ended_at IS NULL)))`;
const FRESH = `EXISTS (SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=? AND payload=? AND kind=? AND applied_at IS NULL)`;
function authority(input: MutationContext) {
  return {
    sql: `${AUTHORITY}${input.administratorsOnly ? ' AND EXISTS(SELECT 1 FROM staff_administrators WHERE person_id=?)' : ''}`,
    values: [
      input.actorId,
      input.committeeId,
      ...(input.administratorsOnly ? [input.actorId] : []),
    ],
  };
}
function fresh(input: MutationContext) {
  return [
    input.operationId,
    input.actorId,
    input.committeeId,
    input.payload,
    `committee.${input.kind}`,
  ];
}
function eligiblePerson(input: MutationContext) {
  if (input.kind !== 'assign')
    return {
      sql: 'EXISTS(SELECT 1 FROM people WHERE id=? AND deleted_at IS NULL)',
      values: [input.personId],
    };
  const claimed = input.fromWelcome
    ? `AND EXISTS(SELECT 1 FROM welcome_claims WHERE person_id=p.id AND actor_id=? AND expires_at>?) AND ${WELCOME_SCOPE}`
    : '';
  return {
    sql: `EXISTS(SELECT 1 FROM people p WHERE p.id=? AND p.deleted_at IS NULL AND p.membership_status='member' ${claimed})`,
    values: [
      input.personId,
      ...(input.fromWelcome ? [input.actorId, input.stamp, input.actorId] : []),
    ],
  };
}
function insertReceipt(db: Db, input: MutationContext): Statement {
  const availability =
    input.kind === 'assign'
      ? 'NOT EXISTS (SELECT 1 FROM committee_assignments WHERE person_id=? AND committee_id=? AND ended_at IS NULL)'
      : 'EXISTS (SELECT 1 FROM committee_assignments WHERE person_id=? AND committee_id=? AND id=? AND ended_at IS NULL)';
  const values =
    input.kind === 'assign'
      ? [input.personId, input.committeeId]
      : [input.personId, input.committeeId, input.id];
  const eligibility = eligiblePerson(input);
  return db
    .prepare(
      `INSERT INTO staff_operations (operation_id,actor_id,kind,target_id,payload,created_at,before_state)
    SELECT ?,?,?,?,?,?,(SELECT json_object('role',role) FROM committee_assignments WHERE person_id=? AND committee_id=? AND ended_at IS NULL) WHERE ${authority(input).sql} AND ${eligibility.sql}
    AND EXISTS(SELECT 1 FROM committees WHERE id=? ${input.kind === 'assign' ? 'AND accepting_members=1' : ''}) AND ${availability} ON CONFLICT(operation_id) DO NOTHING`,
    )
    .bind(
      input.operationId,
      input.actorId,
      `committee.${input.kind}`,
      input.committeeId,
      input.payload,
      input.stamp,
      input.personId,
      input.committeeId,
      ...authority(input).values,
      ...eligibility.values,
      input.committeeId,
      ...values,
    );
}
function changeAssignment(db: Db, input: MutationContext): Statement {
  const guard = `${FRESH} AND ${authority(input).sql}`;
  if (input.kind === 'assign')
    return db
      .prepare(
        `INSERT INTO committee_assignments (id,person_id,committee_id,role,started_at,assigned_by,updated_at)
    SELECT ?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(person_id,committee_id) WHERE ended_at IS NULL DO NOTHING`,
      )
      .bind(
        input.id,
        input.personId,
        input.committeeId,
        input.role,
        input.stamp,
        input.actorId,
        input.stamp,
        ...fresh(input),
        ...authority(input).values,
      );
  if (input.kind === 'change')
    return db
      .prepare(
        `UPDATE committee_assignments SET role=?,updated_at=? WHERE id=? AND ended_at IS NULL AND ${guard}`,
      )
      .bind(input.role, input.stamp, input.id, ...fresh(input), ...authority(input).values);
  return db
    .prepare(
      `UPDATE committee_assignments SET ended_at=?,end_reason=?,ended_by=?,updated_at=? WHERE id=? AND ended_at IS NULL AND ${guard}`,
    )
    .bind(
      input.stamp,
      input.reason ?? null,
      input.actorId,
      input.stamp,
      input.id,
      ...fresh(input),
      ...authority(input).values,
    );
}
function historyWrites(db: Db, input: MutationContext): Statement[] {
  return [
    db
      .prepare(
        `INSERT INTO engagement_events (id,person_id,type,occurred_at,source,reference,details,created_at)
      SELECT ?,?,'role_changed',?,'staff',?,json_set(?,'$.oldRole',(SELECT json_extract(before_state,'$.role') FROM staff_operations WHERE operation_id=?),'$.newRole',?),? WHERE ${FRESH}`,
      )
      .bind(
        ulid(),
        input.personId,
        input.stamp,
        input.operationId,
        JSON.stringify({
          action: input.kind,
          committeeId: input.committeeId,
          role: input.role,
          endReason: input.reason ?? null,
          actorId: input.actorId,
        }),
        input.operationId,
        input.kind === 'end' ? null : input.role,
        input.stamp,
        ...fresh(input),
      ),
    db
      .prepare(
        `INSERT INTO staff_audits (id,actor_id,action,target_id,details,operation_id,occurred_at)
      SELECT ?,?,?,?,?,?,? WHERE ${FRESH}`,
      )
      .bind(
        ulid(),
        input.actorId,
        `committee.${input.kind}`,
        input.personId,
        input.payload,
        input.operationId,
        input.stamp,
        ...fresh(input),
      ),
    db
      .prepare(
        `INSERT INTO reconcile_generations (person_id,target_id,generation)
      SELECT ?,?,1 WHERE ${FRESH} ON CONFLICT(person_id,target_id) DO UPDATE SET generation=generation+1`,
      )
      .bind(input.personId, input.committeeId, ...fresh(input)),
    db
      .prepare(
        `INSERT INTO integration_outbox (id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
      SELECT ?,'committee_reconcile',?,?,g.generation,?,?,?,? FROM reconcile_generations g WHERE g.person_id=? AND g.target_id=? AND ${FRESH}`,
      )
      .bind(
        input.operationId,
        input.personId,
        input.committeeId,
        input.payload,
        input.stamp,
        input.stamp,
        input.stamp,
        input.personId,
        input.committeeId,
        ...fresh(input),
      ),
  ];
}
export async function assignmentMutation(
  db: Db,
  mutation: AssignmentMutation,
): Promise<MutationResult<Assignment>> {
  // Assignment IDs for a new write are generated server-side and excluded from retry identity.
  const payload = JSON.stringify({
    personId: mutation.personId,
    ...(mutation.administratorsOnly ? { administratorsOnly: true } : {}),
    ...(mutation.fromWelcome ? { fromWelcome: true } : {}),
    ...(mutation.kind === 'assign' ? {} : { assignmentId: mutation.id }),
    role: mutation.role,
    ...(mutation.kind === 'end' ? { reason: mutation.reason } : {}),
  });
  const input = { ...mutation, payload, stamp: new Date().toISOString() };
  await db.batch([
    insertReceipt(db, input),
    changeAssignment(db, input),
    ...historyWrites(db, input),
    db
      .prepare(
        `UPDATE staff_operations SET applied_at=?,result=(SELECT json_object('id',id,'person_id',person_id,'committee_id',committee_id,
      'role',role,'started_at',started_at,'ended_at',ended_at,'end_reason',end_reason) FROM committee_assignments WHERE id=?)
      WHERE operation_id=? AND actor_id=? AND target_id=? AND payload=? AND kind=? AND applied_at IS NULL`,
      )
      .bind(input.stamp, input.id, ...fresh(input)),
  ]);
  const receipt = await db
    .prepare(
      `SELECT result FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=? AND payload=? AND kind=? AND applied_at IS NOT NULL`,
    )
    .bind(...fresh(input))
    .first<{ result: string | null }>();
  if (!receipt?.result) return { kind: 'conflict' };
  const row = JSON.parse(receipt.result) as AssignmentRow;
  return { kind: 'ok', value: assignment(row) };
}
