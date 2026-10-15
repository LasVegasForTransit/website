import { t } from '@lasvegasfortransit/platform-core/messages';
import { discordTarget } from './discord-target';
import type { Actor, Page } from '@lasvegasfortransit/platform-core/staff-types';
import type { MembershipStatus } from '@lasvegasfortransit/platform-core/membership';
import {
  needsAccessRecovery,
  type AccessConfiguration,
  type ProviderAccess,
} from '@lasvegasfortransit/platform-core/access';
import { can, PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Db, SqlValue } from './db';
import { loadActor } from './staff-roles';
import { STAFF_ADMIN_SCOPE, STAFF_PERSON_SCOPE } from './staff-scope';
import { COMMITTEE_SCOPE } from './committee-views';
import { auditDenied } from './audits';
import { observedAccess, type ObservedRow } from './access-state';
import { ACCESS_ROWS_QUERY } from './access-query';
import { accessCursor, readAccessCursor } from './access-cursors';
export { discordTarget } from './discord-target';
export { accessHistory, type AccessHistoryRow } from './access-history';
export interface AccessRow {
  personId: string;
  name: string;
  email: string | null;
  membershipStatus: MembershipStatus;
  targetId: string;
  committeeName: string | null;
  assignmentId: string | null;
  role: 'member' | 'lead' | null;
  expectedAccess: boolean;
  discordExpectedAccess: boolean;
  discordResourceId: string | null;
  discordFirstSeenAt: string | null;
  googleConnected: boolean;
  discordConnected: boolean;
  googleWorkspace: ProviderAccess;
  discord: ProviderAccess;
  operationId: string | null;
  operationState: string | null;
  lastFailure: string | null;
}
interface Row
  extends
    ObservedRow,
    Omit<
      AccessRow,
      | 'expectedAccess'
      | 'discordExpectedAccess'
      | 'googleConnected'
      | 'discordConnected'
      | 'googleWorkspace'
      | 'discord'
    > {
  discordExpectedAccess: number;
}
export interface AccessQuery {
  personId?: string | undefined;
  target?: 'member' | 'committee' | undefined;
  committeeId?: string | undefined;
  text?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
  configuration?: AccessConfiguration;
  now?: Date;
  needsAttention?: boolean;
}
function accessRow(
  row: Row,
  context: { configuration: AccessConfiguration; now: Date },
): AccessRow {
  const { configuration, now } = context;
  return {
    personId: row.personId,
    name: row.name || t('staff.accessOverview.unnamed'),
    email: row.email,
    membershipStatus: row.membershipStatus,
    targetId: row.targetId,
    committeeName:
      row.committeeName && discordTarget(row.targetId).lead
        ? t('staff.accessOverview.leadName', { name: row.committeeName })
        : row.committeeName,
    assignmentId: row.assignmentId,
    role: row.role,
    expectedAccess: Boolean(row.expectedAccess),
    discordExpectedAccess: Boolean(row.discordExpectedAccess),
    discordResourceId: row.discordResourceId,
    discordFirstSeenAt: row.discordFirstSeenAt,
    googleConnected: row.googleIdentityCount > 0,
    discordConnected: row.discordIdentityCount > 0,
    googleWorkspace: observedAccess(row, 'google_workspace', configuration, now),
    discord: observedAccess(row, 'discord', configuration, now),
    operationId: row.operationId,
    operationState: row.operationState,
    lastFailure: row.lastFailure,
  };
}
function boundedLimit(limit?: number): number {
  return Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit ?? 25))) : 25;
}
function accessFilters(actor: Actor, query: AccessQuery) {
  const where = [
    'p.deleted_at IS NULL',
    STAFF_PERSON_SCOPE,
    `(${STAFF_ADMIN_SCOPE} OR t.targetId='person' OR (c.id IS NOT NULL AND ${COMMITTEE_SCOPE}))`,
  ];
  const values: SqlValue[] = [actor.personId, actor.personId, actor.personId];
  if (query.personId) {
    where.push('p.id=?');
    values.push(query.personId);
  }
  if (query.committeeId) {
    where.push('c.id=?');
    values.push(query.committeeId);
  }
  if (query.text?.trim()) {
    where.push(
      "instr(lower(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')||' '||coalesce(p.email,'')),lower(?))>0",
    );
    values.push(query.text.trim().slice(0, 254));
  }
  if (query.needsAttention) where.push("o.state='retry'");
  if (query.target)
    where.push(query.target === 'member' ? "t.targetId='person'" : "t.targetId<>'person'");
  return { where, values };
}
export async function listAccess(
  db: Db,
  actor: Actor,
  query: AccessQuery = {},
): Promise<Page<AccessRow>> {
  const current = await loadActor(db, actor.personId);
  if (!current || !can(current, 'access.view')) {
    await auditDenied(db, actor.personId, 'access.view');
    throw new PermissionDenied('access.view');
  }
  let cursor = readAccessCursor(query.cursor);
  const { where, values } = accessFilters(actor, query);
  const limit = boundedLimit(query.limit);
  const configuration = query.configuration ?? {},
    now = query.now ?? new Date();
  const matches: AccessRow[] = [];
  const batchSize = query.needsAttention ? Math.max(100, limit + 1) : limit + 1;
  while (matches.length <= limit) {
    const cursorFilter = cursor ? ' AND (p.id>? OR (p.id=? AND t.targetId>?))' : '';
    const cursorValues: SqlValue[] = cursor ? [cursor[0], cursor[0], cursor[1]] : [];
    const { results } = await db
      .prepare(
        `${ACCESS_ROWS_QUERY}
    WHERE ${where.join(' AND ')}${cursorFilter} ORDER BY p.id,t.targetId LIMIT ?`,
      )
      .bind(...values, ...cursorValues, batchSize)
      .all<Row>();
    const rows = results.map((row) => accessRow(row, { configuration, now }));
    matches.push(...(query.needsAttention ? rows.filter(needsAccessRecovery) : rows));
    const scanned = results.at(-1);
    if (results.length < batchSize || !scanned) break;
    cursor = [scanned.personId, scanned.targetId];
  }
  const items = matches.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      matches.length > limit && last ? accessCursor([last.personId, last.targetId]) : null,
  };
}

/** Complete facts for administrator committee summaries; no per-person provider requests. */
export async function committeeAccessFacts(
  db: Db,
  actor: Actor,
  query: AccessQuery,
): Promise<AccessRow[]> {
  const { where, values } = accessFilters(actor, { ...query, target: 'committee' });
  where.push(STAFF_ADMIN_SCOPE);
  values.push(actor.personId);
  const { results } = await db
    .prepare(`${ACCESS_ROWS_QUERY} WHERE ${where.join(' AND ')} ORDER BY p.id,t.targetId`)
    .bind(...values)
    .all<Row>();
  return results.map((row) =>
    accessRow(row, { configuration: query.configuration ?? {}, now: query.now ?? new Date() }),
  );
}
