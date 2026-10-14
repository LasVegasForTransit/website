import type { Actor, Page } from '@lasvegasfortransit/platform-core/staff-types';
import type { ProviderConfiguration } from '@lasvegasfortransit/platform-core/access';
import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Db, SqlValue } from './db';
import { auditDenied } from './audits';
import { accessCursor } from './access-cursors';
import { readGoogleGroupCursor } from './google-group-cursor';
import { InvalidCursor } from './staff-history';
import { GOOGLE_GROUP_QUERY, GROUP_JSON, HAS_PROBLEM } from './google-group-query';

export interface GoogleGroupSummary {
  groupEmail: string;
  groupId: string | null;
  contentHash: string | null;
  startedAt: string | null;
  checkedAt: string | null;
  expiresAt: string | null;
  isConsole: boolean;
  state: 'current' | 'stale' | 'unavailable' | 'not_checked' | 'not_configured' | 'needs_review';
  userCount: number | null;
  lastUserCount: number | null;
  expectedCount: number;
  missingCount: number | null;
  unexpectedCount: number | null;
  unmatchedCount: number | null;
  unconfirmedCount: number | null;
  needsSeatReview: boolean;
  committees: { id: string; name: string; current: boolean }[];
}
export interface GoogleGroupPerson {
  personId: string;
  name: string;
  email: string | null;
  identityId: string | null;
  state: 'missing' | 'unexpected' | 'unconfirmed';
}
export interface GoogleGroupQuery {
  configuration: ProviderConfiguration;
  consoleGroupEmail: string | null;
  now: Date;
  cursor?: string | undefined;
  limit?: number | undefined;
  problemsOnly?: boolean | undefined;
}
function parameters(actor: Actor, query: GoogleGroupQuery): SqlValue[] {
  return [
    Number(query.configuration.configured),
    query.configuration.contextId,
    JSON.stringify(query.configuration.resourceIds ?? []),
    query.consoleGroupEmail,
    query.now.toISOString(),
    actor.personId,
  ];
}
interface SummaryRow extends Omit<
  GoogleGroupSummary,
  'isConsole' | 'needsSeatReview' | 'committees'
> {
  isConsole: number;
  needsSeatReview: number;
  committees: { id: string; name: string; current: number }[];
}
function summary(row: SummaryRow): GoogleGroupSummary {
  return {
    ...row,
    isConsole: Boolean(row.isConsole),
    needsSeatReview: Boolean(row.needsSeatReview),
    committees: row.committees.map((c) => ({ ...c, current: Boolean(c.current) })),
  };
}
async function requireAllowed<T extends { allowed: number }>(
  db: Db,
  actor: Actor,
  row: T | null,
): Promise<T> {
  if (!row?.allowed) {
    await auditDenied(db, actor.personId, 'staff_admin.manage');
    throw new PermissionDenied('staff_admin.manage');
  }
  return row;
}
function pagination(query: GoogleGroupQuery, scope: string) {
  const cursor = readGoogleGroupCursor(query.cursor);
  if (cursor && cursor[0] !== scope) throw new InvalidCursor();
  return {
    after: cursor?.[1] ?? '',
    limit: Number.isFinite(query.limit)
      ? Math.max(1, Math.min(100, Math.floor(query.limit ?? 25)))
      : 25,
  };
}
export async function listGoogleGroupOverview(
  db: Db,
  actor: Actor,
  query: GoogleGroupQuery,
): Promise<
  Page<GoogleGroupSummary> & {
    console: GoogleGroupSummary | null;
    totalGroups: number;
    totalProblems: number;
  }
> {
  const { after, limit } = pagination(query, 'groups');
  const row = await db
    .prepare(
      `${GOOGLE_GROUP_QUERY}
    SELECT v.allowed,
      (SELECT json_group_array(json(value)) FROM (SELECT ${GROUP_JSON} AS value FROM summaries WHERE NOT is_console AND group_email>? AND (?=0 OR ${HAS_PROBLEM}) ORDER BY group_email LIMIT ?)) AS items,
      (SELECT ${GROUP_JSON} FROM summaries WHERE is_console) AS console,
      (SELECT count(*) FROM summaries WHERE NOT is_console) AS totalGroups,
      (SELECT count(*) FROM summaries WHERE NOT is_console AND ${HAS_PROBLEM}) AS totalProblems
    FROM viewer v`,
    )
    .bind(...parameters(actor, query), after, Number(Boolean(query.problemsOnly)), limit + 1)
    .first<{
      allowed: number;
      items: string;
      console: string | null;
      totalGroups: number;
      totalProblems: number;
    }>();
  const authorized = await requireAllowed(db, actor, row);
  const groups = (JSON.parse(authorized.items) as SummaryRow[]).map(summary);
  const items = groups.slice(0, limit),
    last = items.at(-1);
  return {
    items,
    nextCursor: groups.length > limit && last ? accessCursor(['groups', last.groupEmail]) : null,
    console: authorized.console ? summary(JSON.parse(authorized.console) as SummaryRow) : null,
    totalGroups: authorized.totalGroups,
    totalProblems: authorized.totalProblems,
  };
}
export async function getGoogleGroupReview(
  db: Db,
  actor: Actor,
  query: GoogleGroupQuery & { groupEmail: string },
): Promise<(Page<GoogleGroupPerson> & { summary: GoogleGroupSummary }) | null> {
  const { after, limit } = pagination(query, query.groupEmail);
  const row = await db
    .prepare(
      `${GOOGLE_GROUP_QUERY}, selected AS (SELECT * FROM summaries WHERE group_email=?)
    SELECT v.allowed,(SELECT ${GROUP_JSON} FROM summaries WHERE group_email=?) AS summary,
      (SELECT json_group_array(json(value)) FROM (SELECT json_object('personId',p.id,'name',coalesce(nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),''),p.email,'Name not recorded'),
        'email',p.email,'identityId',d.identity_id,'state',d.state) AS value FROM differences d JOIN people p ON p.id=d.person_id AND p.deleted_at IS NULL JOIN selected s ON s.group_email=d.group_email AND s.state='current'
        WHERE v.allowed AND p.id>? ORDER BY p.id LIMIT ?)) AS items FROM viewer v`,
    )
    .bind(...parameters(actor, query), query.groupEmail, query.groupEmail, after, limit + 1)
    .first<{ allowed: number; summary: string | null; items: string }>();
  const authorized = await requireAllowed(db, actor, row);
  if (!authorized.summary) return null;
  const people = JSON.parse(authorized.items) as GoogleGroupPerson[],
    items = people.slice(0, limit),
    last = items.at(-1);
  return {
    summary: summary(JSON.parse(authorized.summary) as SummaryRow),
    items,
    nextCursor:
      people.length > limit && last ? accessCursor([query.groupEmail, last.personId]) : null,
  };
}
