import type { Actor, Page } from '@lasvegasfortransit/platform-core/staff-types';
import type { MembershipStatus } from '@lasvegasfortransit/platform-core/membership';
import type { AccessConfiguration, ProviderAccess } from '@lasvegasfortransit/platform-core/access';
import { can, PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Db, SqlValue } from './db';
import { loadActor } from './staff-roles';
import { STAFF_ADMIN_SCOPE, STAFF_PERSON_SCOPE } from './staff-scope';
import { COMMITTEE_SCOPE } from './committee-views';
import { auditDenied } from './audits';
import { observedAccess, OBSERVATION_JSON, type ObservedRow } from './access-state';
import { accessCursor, readAccessCursor } from './access-cursors';
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
      'expectedAccess' | 'googleConnected' | 'discordConnected' | 'googleWorkspace' | 'discord'
    > {}
const TARGETS = `WITH targets AS (SELECT person_id AS personId,committee_id AS targetId FROM committee_assignments GROUP BY person_id,committee_id
  UNION SELECT id,'person' FROM people)`;
const CURRENT_JOB = `SELECT o.id FROM integration_outbox o WHERE o.person_id=p.id AND o.target_id=t.targetId AND o.generation=coalesce(g.generation,0)
  AND o.kind IN ('person_reconcile','committee_reconcile') ORDER BY o.created_at DESC,o.id DESC LIMIT 1`;
function observation(provider: string) {
  return `(SELECT ${OBSERVATION_JSON} FROM access_observations WHERE person_id=p.id AND target_id=t.targetId AND provider='${provider}' ORDER BY observed_at DESC,rowid DESC LIMIT 1)`;
}
export interface AccessQuery {
  personId?: string | undefined;
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
    name: row.name,
    email: row.email,
    membershipStatus: row.membershipStatus,
    targetId: row.targetId,
    committeeName: row.committeeName,
    assignmentId: row.assignmentId,
    role: row.role,
    expectedAccess: Boolean(row.expectedAccess),
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
  const cursor = readAccessCursor(query.cursor);
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
  if (cursor) {
    where.push('(p.id>? OR (p.id=? AND t.targetId>?))');
    values.push(cursor[0], cursor[0], cursor[1]);
  }
  const limit = boundedLimit(query.limit);
  const { results } = await db
    .prepare(
      `${TARGETS}
    SELECT p.id AS personId,t.targetId,coalesce(nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),''),p.email,'Name not recorded') AS name,
    p.email,p.membership_status AS membershipStatus,c.name AS committeeName,a.id AS assignmentId,a.role,
    CASE WHEN p.membership_status='member' AND (t.targetId='person' OR a.id IS NOT NULL) THEN 1 ELSE 0 END AS expectedAccess,
    coalesce(g.generation,0) AS generation,
    (SELECT count(*) FROM identities WHERE person_id=p.id AND platform='google_workspace') AS googleIdentityCount,
    (SELECT count(*) FROM identities WHERE person_id=p.id AND platform='discord') AS discordIdentityCount,
    (SELECT external_id FROM identities WHERE person_id=p.id AND platform='google_workspace') AS googleIdentity,
    (SELECT external_email FROM identities WHERE person_id=p.id AND platform='google_workspace') AS googleEmail,
    (SELECT external_id FROM identities WHERE person_id=p.id AND platform='discord' AND link_method IN ('self_linked','staff_confirmed')) AS discordIdentity,
    c.workspace_group_email AS workspaceGroupEmail,c.discord_role_id AS discordRoleId,
    ${observation('google_workspace')} AS googleObservation,${observation('discord')} AS discordObservation,
    o.id AS operationId,o.state AS operationState,o.last_failure AS lastFailure
    FROM targets t JOIN people p ON p.id=t.personId LEFT JOIN committees c ON c.id=t.targetId
    LEFT JOIN committee_assignments a ON a.person_id=p.id AND a.committee_id=c.id AND a.ended_at IS NULL
    LEFT JOIN reconcile_generations g ON g.person_id=p.id AND g.target_id=t.targetId
    LEFT JOIN integration_outbox o ON o.id=(${CURRENT_JOB})
    WHERE ${where.join(' AND ')} ORDER BY p.id,t.targetId LIMIT ?`,
    )
    .bind(...values, limit + 1)
    .all<Row>();
  const configuration = query.configuration ?? {},
    now = query.now ?? new Date();
  const items = results.slice(0, limit).map((row) => accessRow(row, { configuration, now }));
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      results.length > limit && last ? accessCursor([last.personId, last.targetId]) : null,
  };
}
