import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Actor, MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db, SqlValue } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditDenied } from './audits';

export interface OrganizationRole {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  retiredAt: string | null;
}
export interface PersonOrganizationRole {
  id: string;
  roleId: string;
  name: string;
  assignedAt: string;
  retiredAt: string | null;
}
export const ROLE_COLUMNS =
  'id,name,created_at AS createdAt,updated_at AS updatedAt,retired_at AS retiredAt';
export const ROLE_RESULT =
  "SELECT json_object('id',id,'name',name,'createdAt',created_at,'updatedAt',updated_at,'retiredAt',retired_at) FROM organization_roles WHERE id=?";
export async function organizationRoleAdministrator(db: Db, actorId: string): Promise<boolean> {
  return Boolean(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actorId).first());
}
export function validRoleId(id: string): boolean {
  return typeof id === 'string' && /^[\w-]{1,100}$/.test(id);
}
interface RoleMutation {
  kind: string;
  targetId: string;
  auditTargetId?: string;
  operationId: string;
  payload: string;
  guard: string;
  guardValues: SqlValue[];
  write: string;
  writeValues: SqlValue[];
  result: string;
  resultValues: SqlValue[];
  stamp: string;
}
interface Receipt {
  actor_id: string;
  kind: string;
  target_id: string;
  payload: string;
  applied_at: string | null;
  result: string | null;
}
async function readReceipt(db: Db, actorId: string, operationId: string): Promise<Receipt | null> {
  return db
    .prepare(
      `SELECT actor_id,kind,target_id,payload,applied_at,result FROM staff_operations WHERE operation_id=? AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(operationId, actorId)
    .first<Receipt>();
}
function receiptResult<T>(
  receipt: Receipt,
  actorId: string,
  input: RoleMutation,
): MutationResult<T> {
  return receipt.actor_id === actorId &&
    receipt.kind === input.kind &&
    receipt.target_id === input.targetId &&
    receipt.payload === input.payload &&
    receipt.applied_at &&
    receipt.result
    ? { kind: 'ok', value: JSON.parse(receipt.result) as T }
    : { kind: 'conflict' };
}
/** The receipt, mutation and audit share the current administrator fence and one transaction. */
export async function mutateOrganizationRole<T>(
  db: Db,
  actor: Actor,
  input: RoleMutation,
): Promise<MutationResult<T>> {
  if (!(await organizationRoleAdministrator(db, actor.personId))) {
    await auditDenied(db, actor.personId, 'person.update');
    return { kind: 'forbidden' };
  }
  if (!input.operationId.trim() || input.operationId.length > 200) return { kind: 'invalid' };
  const prior = await readReceipt(db, actor.personId, input.operationId);
  if (prior) return receiptResult(prior, actor.personId, input);
  const values = [input.operationId, actor.personId, input.kind, input.targetId, input.payload];
  const fence = `EXISTS(SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND kind=? AND target_id=? AND payload=? AND applied_at IS NULL) AND ${STAFF_ADMIN_SCOPE}`;
  const fresh = [...values, actor.personId];
  await db.batch([
    db
      .prepare(
        `INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,created_at) SELECT ?,?,?,?,?,? WHERE ${STAFF_ADMIN_SCOPE} AND (${input.guard}) ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(...values, input.stamp, actor.personId, ...input.guardValues),
    db.prepare(input.write.replace('%FENCE%', fence)).bind(...input.writeValues, ...fresh),
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at) SELECT ?,?,?,?,?,?,? WHERE ${fence}`,
      )
      .bind(
        ulid(),
        actor.personId,
        input.kind,
        input.auditTargetId ?? input.targetId,
        input.payload,
        input.operationId,
        input.stamp,
        ...fresh,
      ),
    db
      .prepare(`UPDATE staff_operations SET applied_at=?,result=(${input.result}) WHERE ${fence}`)
      .bind(input.stamp, ...input.resultValues, ...fresh),
  ]);
  const saved = await readReceipt(db, actor.personId, input.operationId);
  return saved
    ? receiptResult(saved, actor.personId, input)
    : {
        kind: (await organizationRoleAdministrator(db, actor.personId)) ? 'conflict' : 'forbidden',
      };
}
