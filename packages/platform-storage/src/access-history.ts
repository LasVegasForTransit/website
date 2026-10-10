import type { Actor, Page } from '@lasvegasfortransit/platform-core/staff-types';
import { can, PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Db, SqlValue } from './db';
import { loadActor } from './staff-roles';
import { STAFF_ADMIN_SCOPE, STAFF_PERSON_SCOPE } from './staff-scope';
import { COMMITTEE_SCOPE } from './committee-views';
import { auditDenied } from './audits';
import { accessCursor, readAccessCursor } from './access-cursors';
export interface AccessHistoryRow {
  id: string;
  occurredAt: string;
  action: string;
  personName: string | null;
  committeeId: string | null;
  committeeName: string | null;
  actorName: string | null;
  role: string | null;
  reason: string | null;
  provider: string | null;
  source: string | null;
  requestedByName: string | null;
}
export async function accessHistory(
  db: Db,
  actor: Actor,
  input: {
    personId?: string | undefined;
    committeeId?: string | undefined;
    cursor?: string | undefined;
    now?: Date;
    limit?: number;
    administratorsOnly?: boolean;
    providersOnly?: boolean;
  } = {},
): Promise<Page<AccessHistoryRow>> {
  const current = await loadActor(db, actor.personId);
  if (
    !current ||
    !can(current, 'access.view') ||
    (input.administratorsOnly && !current.staffAdmin)
  ) {
    await auditDenied(db, actor.personId, 'access.view');
    throw new PermissionDenied('access.view');
  }
  const cutoff = new Date(input.now ?? new Date());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 3);
  const where = [
    input.providersOnly
      ? "a.action IN ('access.granted','access.revoked')"
      : "a.action IN ('committee.assign','committee.change','committee.end','committee.settings','access.retry','staff_admin.manage','access.granted','access.revoked')",
    'a.occurred_at>=?',
    `(${STAFF_ADMIN_SCOPE} OR (p.deleted_at IS NULL AND ${COMMITTEE_SCOPE} AND (a.action='committee.settings' OR ${STAFF_PERSON_SCOPE})))`,
    "(p.deleted_at IS NULL OR a.action IN ('committee.settings','access.granted','access.revoked'))",
  ];
  const values: SqlValue[] = [cutoff.toISOString(), actor.personId, actor.personId, actor.personId];
  if (input.personId) {
    where.push('p.id=?');
    values.push(input.personId);
  }
  if (input.committeeId) {
    where.push('c.id=?');
    values.push(input.committeeId);
  }
  const cursor = readAccessCursor(input.cursor);
  if (cursor) {
    where.push('(a.occurred_at<? OR (a.occurred_at=? AND a.id<?))');
    values.push(cursor[0], cursor[0], cursor[1]);
  }
  const limit = Number.isFinite(input.limit)
    ? Math.max(1, Math.min(100, Math.floor(input.limit ?? 25)))
    : 25;
  const { results } = await db
    .prepare(
      `SELECT a.id,a.occurred_at AS occurredAt,a.action,
    CASE WHEN p.deleted_at IS NOT NULL THEN 'Deleted record' ELSE nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),'') END AS personName,
    CASE a.actor_id WHEN 'platform:discord' THEN 'Automatic Discord update' WHEN 'platform:google_workspace' THEN 'Automatic Google update' ELSE nullif(trim(coalesce(recorder.given_name,'')||' '||coalesce(recorder.family_name,'')),'') END AS actorName,
    c.id AS committeeId,c.name AS committeeName,json_extract(a.details,'$.role') AS role,json_extract(a.details,'$.reason') AS reason,
    json_extract(a.details,'$.provider') AS provider,json_extract(a.details,'$.source') AS source,
    nullif(trim(coalesce(requester.given_name,'')||' '||coalesce(requester.family_name,'')),'') AS requestedByName
    FROM staff_audits a LEFT JOIN staff_operations receipt ON receipt.operation_id=a.operation_id
    LEFT JOIN committees c ON c.id=CASE WHEN a.action='committee.settings' THEN a.target_id WHEN a.action IN ('access.retry','access.granted','access.revoked') THEN json_extract(a.details,'$.targetId') ELSE receipt.target_id END
    LEFT JOIN people p ON p.id=CASE WHEN a.action='committee.settings' THEN NULL ELSE a.target_id END
    LEFT JOIN people recorder ON recorder.id=a.actor_id AND recorder.deleted_at IS NULL
    LEFT JOIN people requester ON requester.id=json_extract(a.details,'$.requestedBy') AND requester.deleted_at IS NULL
    WHERE ${where.join(' AND ')} ORDER BY a.occurred_at DESC,a.id DESC LIMIT ?`,
    )
    .bind(...values, limit + 1)
    .all<AccessHistoryRow>();
  const items = results.slice(0, limit),
    last = items.at(-1);
  return {
    items,
    nextCursor: results.length > limit && last ? accessCursor([last.occurredAt, last.id]) : null,
  };
}
