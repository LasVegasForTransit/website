import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import type { SsoPrincipal } from './staff-sso';
import { validSsoPrincipal as valid } from './staff-sso-provisioning';
interface SsoBootstrapInput {
  presidentPersonId: string;
  principal: SsoPrincipal;
  performedBy: string;
  operationId: string;
}
export async function bootstrapSsoStaffAdmin(
  db: Db,
  input: SsoBootstrapInput,
  now = new Date(),
): Promise<MutationResult<{ personId: string }>> {
  if (!valid(input.principal, now) || !input.performedBy.trim() || !input.operationId)
    return { kind: 'invalid' };
  const guard = `EXISTS(SELECT 1 FROM staff_sso_links l JOIN people p ON p.id=l.person_id WHERE l.person_id=? AND l.issuer=? AND l.subject=? AND l.revoked_at IS NULL AND p.deleted_at IS NULL AND p.membership_status='member')`;
  const values = [input.presidentPersonId, input.principal.issuer, input.principal.subject];
  const linked = await db
    .prepare(`SELECT 1 WHERE ${guard}`)
    .bind(...values)
    .first();
  if (!linked) return { kind: 'invalid' };
  const payload = JSON.stringify({
    issuer: input.principal.issuer,
    subject: input.principal.subject,
    performedBy: input.performedBy,
  });
  const stamp = now.toISOString();
  const receipt = `EXISTS(SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=? AND kind='staff_admin.bootstrap' AND payload=? AND applied_at IS NULL)`;
  const receiptValues = [
    input.operationId,
    input.presidentPersonId,
    input.presidentPersonId,
    payload,
  ];
  await db.batch([
    db
      .prepare(
        `INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,created_at) SELECT ?,?,'staff_admin.bootstrap',?,?,? WHERE NOT EXISTS(SELECT 1 FROM staff_administrators) AND ${guard} ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(
        input.operationId,
        input.presidentPersonId,
        input.presidentPersonId,
        payload,
        stamp,
        ...values,
      ),
    db
      .prepare(
        `INSERT INTO staff_administrators(person_id,designated_by,designated_at) SELECT ?,?,? WHERE ${receipt} AND ${guard} ON CONFLICT(person_id) DO NOTHING`,
      )
      .bind(input.presidentPersonId, input.performedBy, stamp, ...receiptValues, ...values),
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at) SELECT ?,?,'staff_admin.bootstrap',?,?,?,? WHERE ${receipt} AND EXISTS(SELECT 1 FROM staff_administrators WHERE person_id=?) ON CONFLICT(operation_id,action) WHERE operation_id IS NOT NULL DO NOTHING`,
      )
      .bind(
        ulid(),
        input.presidentPersonId,
        input.presidentPersonId,
        payload,
        input.operationId,
        stamp,
        ...receiptValues,
        input.presidentPersonId,
      ),
    db
      .prepare(
        `UPDATE staff_operations SET applied_at=?,result=? WHERE operation_id=? AND actor_id=? AND target_id=? AND kind='staff_admin.bootstrap' AND payload=? AND applied_at IS NULL AND EXISTS(SELECT 1 FROM staff_audits WHERE operation_id=? AND action='staff_admin.bootstrap')`,
      )
      .bind(
        stamp,
        JSON.stringify({ personId: input.presidentPersonId }),
        ...receiptValues,
        input.operationId,
      ),
  ]);
  return (await db
    .prepare(
      "SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=? AND payload=? AND kind='staff_admin.bootstrap' AND applied_at IS NOT NULL",
    )
    .bind(...receiptValues)
    .first())
    ? { kind: 'ok', value: { personId: input.presidentPersonId } }
    : { kind: 'conflict' };
}
