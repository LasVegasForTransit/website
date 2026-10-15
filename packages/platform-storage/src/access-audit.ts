import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Actor, Page } from '@lasvegasfortransit/platform-core/staff-types';
import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Db, SqlValue, Statement } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditDenied } from './audits';
import { accessCursor, readAccessCursor, accessPageLimit } from './access-cursors';

export const ACCESS_SYSTEMS = [
  'google_workspace',
  'google_group',
  'discord',
  'github',
  'checklist',
] as const;
export const ACCESS_ACTIONS = [
  'grant',
  'revoke',
  'suspend',
  'unsuspend',
  'transfer',
  'delete',
] as const;
export const ACCESS_REASONS = [
  'committee_assignment',
  'committee_role_changed',
  'committee_assignment_ended',
  'membership_change',
  'account_linked',
  'account_disconnected',
  'staff_correction',
  'periodic_check',
  'onboarding',
  'person_deleted',
  'access_page',
] as const;
export type AccessSystem = (typeof ACCESS_SYSTEMS)[number];
export type AccessAction = (typeof ACCESS_ACTIONS)[number];
export interface AccessChange {
  personId: string;
  system: AccessSystem;
  action: AccessAction;
  target: string;
  actor: string;
  reason: (typeof ACCESS_REASONS)[number];
  operationId: string;
  changed: boolean;
}
const ACTIONS = {
  grant: 'access.granted',
  revoke: 'access.revoked',
  suspend: 'access.suspended',
  unsuspend: 'access.unsuspended',
  transfer: 'access.transferred',
  delete: 'access.deleted',
};
export const ACCESS_CHANGE_ACTIONS = Object.values(ACTIONS)
  .map((value) => `'${value}'`)
  .join(',');
const INSERT =
  'INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at)';
/** The same guarded writer serves actual provider confirmations and other access systems.
 * Callers retain their transaction/ownership fence. Requests and unchanged reads are not changes.
 */
export function accessChangeWrite(
  db: Db,
  input:
    { intentId: string; guard: { sql: string; values: SqlValue[] } } | { change: AccessChange },
  at: Date,
): Statement {
  if (!Number.isFinite(at.getTime())) throw new Error('Invalid access-change time');
  if ('intentId' in input)
    return db
      .prepare(
        `${INSERT}
      SELECT id,'platform:'||provider,CASE after_granted WHEN 1 THEN 'access.granted' ELSE 'access.revoked' END,person_id,
        json_object('system',CASE provider WHEN 'google_workspace' THEN 'google_group' ELSE provider END,'provider',provider,'identityId',identity_id,'contextId',context_id,'resourceId',resource_id,'targetId',target_id,'generation',generation,'source',source,'reason',CASE WHEN source IN ('google_group_review','access.group_update') AND after_granted=0 THEN 'access_page' WHEN source='committee.assign' THEN 'committee_assignment' WHEN source='committee.change' THEN 'committee_role_changed' WHEN source='committee.end' THEN 'committee_assignment_ended' WHEN source='discord_drift' THEN 'periodic_check' WHEN source='discord_link' THEN 'account_linked' WHEN source='discord_disconnect' THEN 'account_disconnected' WHEN source IN ('membership_change','person_deleted') THEN source ELSE 'staff_correction' END,'requestedBy',requested_by,'operationId',operation_id,'preparedAt',prepared_at,'proof','provider_read'),
        'provider-change:'||id,? FROM provider_access_intents WHERE id=? AND before_granted<>after_granted AND ${input.guard.sql} ON CONFLICT(id) DO NOTHING`,
      )
      .bind(at.toISOString(), input.intentId, ...input.guard.values);
  const c = input.change;
  if (
    !ACCESS_SYSTEMS.includes(c.system) ||
    !ACCESS_ACTIONS.includes(c.action) ||
    !ACCESS_REASONS.includes(c.reason) ||
    typeof c.changed !== 'boolean' ||
    [c.personId, c.target, c.actor, c.operationId].some(
      (value) => !value || value.length > 254 || /\p{Cc}/u.test(value),
    )
  )
    throw new Error('Invalid access change');
  // No arbitrary details or message bodies enter this API.
  return db.prepare(`${INSERT} SELECT ?,?,?,?,?,?,? WHERE ? ON CONFLICT DO NOTHING`).bind(
    ulid(),
    c.actor,
    ACTIONS[c.action],
    c.personId,
    JSON.stringify({
      system: c.system,
      provider: c.system === 'google_group' ? 'google_workspace' : c.system,
      resourceId: c.target,
      reason: c.reason,
      proof: 'confirmed_change',
    }),
    `access-change:${c.operationId}`,
    at.toISOString(),
    Number(c.changed),
  );
}
export interface AccessChangeRow {
  id: string;
  personId: string;
  personName: string | null;
  actorName: string | null;
  system: AccessSystem | null;
  action: AccessAction;
  target: string | null;
  actor: string;
  reason: string | null;
  at: string;
  personDeleted: boolean;
}
/** A normalized view of the existing immutable log; erasure never reconstructs redacted details. */
export const ACCESS_CHANGE_VIEW = `WITH access_changes AS (
 SELECT a.id,a.target_id AS personId,
   CASE WHEN p.deleted_at IS NULL THEN nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),'') END AS personName,
   nullif(trim(coalesce(recorder.given_name,'')||' '||coalesce(recorder.family_name,'')),'') AS actorName,
   coalesce(json_extract(a.details,'$.system'),CASE json_extract(a.details,'$.provider') WHEN 'google_workspace' THEN 'google_group' ELSE json_extract(a.details,'$.provider') END) AS system,
   CASE a.action WHEN 'access.granted' THEN 'grant' WHEN 'access.revoked' THEN 'revoke' WHEN 'access.suspended' THEN 'suspend' WHEN 'access.unsuspended' THEN 'unsuspend' WHEN 'access.transferred' THEN 'transfer' WHEN 'access.deleted' THEN 'delete' END AS action,
   json_extract(a.details,'$.resourceId') AS target,
   CASE WHEN a.actor_id='platform' OR a.actor_id LIKE 'platform:%' THEN 'platform' ELSE a.actor_id END AS actor,
   coalesce(json_extract(a.details,'$.reason'),json_extract(a.details,'$.source')) AS reason,
   a.occurred_at AS at,(p.id IS NULL OR p.deleted_at IS NOT NULL) AS personDeleted
 FROM staff_audits a LEFT JOIN people p ON p.id=a.target_id LEFT JOIN people recorder ON recorder.id=a.actor_id AND recorder.deleted_at IS NULL WHERE a.action IN (${ACCESS_CHANGE_ACTIONS})
)`;
export async function listAccessChanges(
  db: Db,
  actor: Actor,
  input: {
    personId?: string;
    system?: AccessSystem;
    since?: Date;
    now?: Date;
    cursor?: string;
    limit?: number;
  } = {},
): Promise<Page<AccessChangeRow>> {
  const now = input.now ?? new Date(),
    cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 3);
  if (!Number.isFinite(now.getTime()) || (input.since && !Number.isFinite(input.since.getTime())))
    throw new Error('Invalid access-history time');
  const since = input.since && input.since > cutoff ? input.since : cutoff;
  const where = [STAFF_ADMIN_SCOPE, 'at>=?', 'at<=?'],
    values: SqlValue[] = [actor.personId, since.toISOString(), now.toISOString()];
  if (input.personId) {
    where.push('personId=?');
    values.push(input.personId);
  }
  if (input.system) {
    where.push('system=?');
    values.push(input.system);
  }
  const cursor = readAccessCursor(input.cursor);
  if (cursor) {
    where.push('(at<? OR (at=? AND id<?))');
    values.push(cursor[0], cursor[0], cursor[1]);
  }
  const limit = accessPageLimit(input.limit);
  const allowed = await db
    .prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`)
    .bind(actor.personId)
    .first();
  if (!allowed) {
    await auditDenied(db, actor.personId, 'staff_admin.manage');
    throw new PermissionDenied('staff_admin.manage');
  }
  const { results } = await db
    .prepare(
      `${ACCESS_CHANGE_VIEW} SELECT * FROM access_changes WHERE ${where.join(' AND ')} ORDER BY at DESC,id DESC LIMIT ?`,
    )
    .bind(...values, limit + 1)
    .all<Omit<AccessChangeRow, 'personDeleted'> & { personDeleted: number }>();
  const items = results.slice(0, limit).map((row) => ({
      ...row,
      system: ACCESS_SYSTEMS.find((system) => system === row.system) ?? null,
      personDeleted: row.personDeleted === 1,
    })),
    last = items.at(-1);
  return {
    items,
    nextCursor: results.length > limit && last ? accessCursor([last.at, last.id]) : null,
  };
}
