import type { Actor, MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditDenied } from './audits';
import { CommitteeService } from './committees';
import { googleGroupActionPayload, googleGroupRequestWrites } from './google-group-action-writes';
import {
  googleGroupActionGuard,
  validGoogleGroupAction,
  type GoogleGroupAction,
} from './google-group-action-guard';
export type { GoogleGroupAction } from './google-group-action-guard';
async function allowed(db: Db, actor: Actor): Promise<boolean> {
  if (await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actor.personId).first())
    return true;
  await auditDenied(db, actor.personId, 'staff_admin.manage');
  return false;
}
export async function requestGoogleGroupAccessUpdate(
  db: Db,
  actor: Actor,
  input: GoogleGroupAction,
  now: Date,
): Promise<MutationResult<{ personId: string; groupEmail: string }>> {
  if (!validGoogleGroupAction(input, now)) return { kind: 'invalid' };
  if (!(await allowed(db, actor))) return { kind: 'forbidden' };
  const payload = googleGroupActionPayload(input);
  const values = [input.operationId, actor.personId, input.personId, payload];
  await db.batch(googleGroupRequestWrites(db, actor, input, now));
  const row = await db
    .prepare(
      `SELECT result FROM staff_operations WHERE operation_id=? AND actor_id=? AND kind='access.group_update' AND target_id=? AND payload=? AND applied_at IS NOT NULL AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(...values, actor.personId)
    .first<{ result: string }>();
  return row
    ? { kind: 'ok', value: JSON.parse(row.result) as { personId: string; groupEmail: string } }
    : { kind: 'conflict' };
}
export async function assignGoogleGroupMember(
  db: Db,
  actor: Actor,
  input: GoogleGroupAction & { committeeId: string },
  now: Date,
) {
  if (
    !validGoogleGroupAction(input, now) ||
    input.expectedAccess ||
    !input.committeeId ||
    input.committeeId.length > 200
  )
    return { kind: 'invalid' } as const;
  if (!(await allowed(db, actor))) return { kind: 'forbidden' } as const;
  const guard = googleGroupActionGuard(actor, input, now);
  return await new CommitteeService(db).assign({
    personId: input.personId,
    committeeId: input.committeeId,
    role: 'member',
    actorId: actor.personId,
    operationId: input.operationId,
    administratorsOnly: true,
    reviewGuard: {
      sql: `${guard.sql} AND EXISTS(SELECT 1 FROM committees WHERE id=? AND workspace_group_email=?)`,
      values: [...guard.values, input.committeeId, input.groupEmail],
    },
  });
}
