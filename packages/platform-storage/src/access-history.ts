import { t } from '@lasvegasfortransit/platform-core/messages';
import type { Actor, Page } from '@lasvegasfortransit/platform-core/staff-types';
import { can, PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Db, SqlValue } from './db';
import { loadActor } from './staff-roles';
import { STAFF_ADMIN_SCOPE, STAFF_PERSON_SCOPE } from './staff-scope';
import { COMMITTEE_SCOPE } from './committee-views';
import { auditDenied } from './audits';
import { committeeTargetSql, discordLeadSql } from './discord-target';
import { ACCESS_CHANGE_ACTIONS } from './access-audit';
import { accessCursor, readAccessCursor } from './access-cursors';
export interface AccessHistoryRow {
  id: string;
  occurredAt: string;
  action: string;
  personName: string | null;
  personDeleted: boolean;
  committeeId: string | null;
  committeeName: string | null;
  actorName: string | null;
  actorKind: 'person' | 'discord' | 'google_workspace' | 'platform';
  role: string | null;
  reason: string | null;
  provider: string | null;
  source: string | null;
  requestedByName: string | null;
  mappingState?: 'current' | 'retained' | null;
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
      ? `a.action IN (${ACCESS_CHANGE_ACTIONS})`
      : `a.action IN ('committee.assign','committee.change','committee.end','committee.settings','access.retry','access.group_update','staff_admin.manage',${ACCESS_CHANGE_ACTIONS})`,
    'a.occurred_at>=?',
    `(${STAFF_ADMIN_SCOPE} OR (p.deleted_at IS NULL AND ${COMMITTEE_SCOPE} AND (a.action='committee.settings' OR ${STAFF_PERSON_SCOPE})))`,
    `(p.deleted_at IS NULL OR a.action IN ('committee.settings',${ACCESS_CHANGE_ACTIONS}))`,
  ];
  const values: SqlValue[] = [cutoff.toISOString(), actor.personId, actor.personId, actor.personId];
  if (input.personId) {
    where.push('a.target_id=?');
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
    CASE WHEN p.deleted_at IS NULL THEN nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),'') END AS personName,
    (a.action<>'committee.settings' AND (p.id IS NULL OR p.deleted_at IS NOT NULL)) AS personDeleted,
    CASE a.actor_id WHEN 'platform:discord' THEN 'discord' WHEN 'platform:google_workspace' THEN 'google_workspace' ELSE CASE WHEN a.actor_id='platform' OR a.actor_id LIKE 'platform:%' THEN 'platform' ELSE 'person' END END AS actorKind,
    CASE WHEN a.actor_id<>'platform' AND a.actor_id NOT LIKE 'platform:%' THEN nullif(trim(coalesce(recorder.given_name,'')||' '||coalesce(recorder.family_name,'')),'') END AS actorName,
    c.id AS committeeId,CASE WHEN ${discordLeadSql("json_extract(a.details,'$.targetId')", "json_extract(a.details,'$.provider')")} THEN 1 ELSE 0 END AS committeeLead,c.name AS committeeName,json_extract(a.details,'$.role') AS role,json_extract(a.details,'$.reason') AS reason,
    coalesce(json_extract(a.details,'$.system'),json_extract(a.details,'$.provider')) AS provider,json_extract(a.details,'$.source') AS source,json_extract(a.details,'$.mappingState') AS mappingState,
    nullif(trim(coalesce(requester.given_name,'')||' '||coalesce(requester.family_name,'')),'') AS requestedByName
    FROM staff_audits a LEFT JOIN staff_operations receipt ON receipt.operation_id=a.operation_id
    LEFT JOIN committees c ON c.id=CASE WHEN a.action='committee.settings' THEN a.target_id WHEN a.action IN ('access.retry','access.group_update','access.granted','access.revoked') THEN ${committeeTargetSql("json_extract(a.details,'$.targetId')", "json_extract(a.details,'$.provider')")} ELSE receipt.target_id END
    LEFT JOIN people p ON p.id=CASE WHEN a.action='committee.settings' THEN NULL ELSE a.target_id END
    LEFT JOIN people recorder ON recorder.id=a.actor_id AND recorder.deleted_at IS NULL
    LEFT JOIN people requester ON requester.id=json_extract(a.details,'$.requestedBy') AND requester.deleted_at IS NULL
    WHERE ${where.join(' AND ')} ORDER BY a.occurred_at DESC,a.id DESC LIMIT ?`,
    )
    .bind(...values, limit + 1)
    .all<
      Omit<AccessHistoryRow, 'personDeleted'> & { personDeleted: number; committeeLead: number }
    >();
  const items = results.slice(0, limit).map(historyRow),
    last = items.at(-1);
  return {
    items,
    nextCursor: results.length > limit && last ? accessCursor([last.occurredAt, last.id]) : null,
  };
}

function historyRow({
  committeeLead,
  ...row
}: Omit<AccessHistoryRow, 'personDeleted'> & {
  personDeleted: number;
  committeeLead: number;
}): AccessHistoryRow {
  return {
    ...row,
    committeeName:
      committeeLead && row.committeeName
        ? t('staff.accessOverview.leadName', { name: row.committeeName })
        : row.committeeName,
    personDeleted: row.personDeleted === 1,
  };
}
