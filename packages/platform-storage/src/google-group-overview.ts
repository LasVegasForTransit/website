import { t } from '@lasvegasfortransit/platform-core/messages';
import type { Actor, Page } from '@lasvegasfortransit/platform-core/staff-types';
import type { ProviderConfiguration } from '@lasvegasfortransit/platform-core/access';
import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Db } from './db';
import { auditDenied } from './audits';
import { accessCursor } from './access-cursors';
import { readGoogleGroupCursor } from './google-group-cursor';
import { InvalidCursor } from './staff-history';
import {
  GOOGLE_GROUP_QUERY,
  GROUP_JSON,
  googleGroupQueryParameters as parameters,
} from './google-group-query';

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
  assignmentCommitteeId: string | null;
  firstSeenAt: string | null;
  requestState: 'queued' | 'running' | 'retry' | 'done' | null;
  requestReviewReason: 'inherited_access' | null;
}
interface GroupPersonRow extends Omit<GoogleGroupPerson, 'requestState' | 'requestReviewReason'> {
  request: {
    state: GoogleGroupPerson['requestState'];
    reviewReason: GoogleGroupPerson['requestReviewReason'];
  } | null;
}
function groupPerson(row: GroupPersonRow): GoogleGroupPerson {
  const { request, ...person } = row;
  return {
    ...person,
    name: person.name || t('staff.accessOverview.unnamed'),
    requestState: request?.state ?? null,
    requestReviewReason: request?.reviewReason ?? null,
  };
}
export interface GoogleGroupQuery {
  configuration: ProviderConfiguration;
  consoleGroupEmail: string | null;
  now: Date;
  cursor?: string | undefined;
  limit?: number | undefined;
  problemsOnly?: boolean | undefined;
}
interface SummaryRow extends Omit<
  GoogleGroupSummary,
  'isConsole' | 'needsSeatReview' | 'committees'
> {
  isConsole: number;
  needsSeatReview: number;
  committees: { id: string; name: string; current: number }[];
}
interface OverviewRow {
  allowed: number;
  group_email: string | null;
  is_console: number | null;
  state: GoogleGroupSummary['state'] | null;
  group_id: string | null;
  content_hash: string | null;
  started_at: string | null;
  observed_at: string | null;
  expires_at: string | null;
  member_count: number | null;
  user_count: number | null;
  actual_count: number | null;
  actual_users: number | null;
  unbounded: number | null;
  expected_count: number | null;
  missing_count: number | null;
  unexpected_count: number | null;
  unconfirmed_count: number | null;
  unmatched_count: number | null;
  check_state: string | null;
  linked_committee_id: string | null;
  linked_committee_name: string | null;
  linked_committee_current: number | null;
}
function overviewSummary(
  row: OverviewRow & { group_email: string; state: GoogleGroupSummary['state'] },
): GoogleGroupSummary {
  const current = row.state === 'current';
  const confirmed =
    row.actual_count === row.member_count && row.actual_users === row.user_count && !row.unbounded;
  return {
    groupEmail: row.group_email,
    groupId: row.group_id,
    contentHash: row.content_hash,
    startedAt: row.started_at,
    checkedAt: row.observed_at,
    expiresAt: row.expires_at,
    isConsole: Boolean(row.is_console),
    state: row.state,
    userCount: current ? row.user_count : null,
    lastUserCount: confirmed ? row.user_count : null,
    expectedCount: row.expected_count ?? 0,
    missingCount: current ? row.missing_count : null,
    unexpectedCount: current ? row.unexpected_count : null,
    unmatchedCount: current ? row.unmatched_count : null,
    unconfirmedCount: current ? row.unconfirmed_count : null,
    needsSeatReview: Boolean(
      row.is_console && current && row.user_count !== null && row.user_count >= 45,
    ),
    committees: [],
  };
}
function overviewSummaries(rows: OverviewRow[]): GoogleGroupSummary[] {
  const byEmail = new Map<string, GoogleGroupSummary>();
  for (const row of rows) {
    if (!row.group_email || !row.state) continue;
    let item = byEmail.get(row.group_email);
    if (!item) {
      item = overviewSummary({ ...row, group_email: row.group_email, state: row.state });
      byEmail.set(row.group_email, item);
    }
    if (row.linked_committee_id && row.linked_committee_name) {
      item.committees.push({
        id: row.linked_committee_id,
        name: row.linked_committee_name,
        current: Boolean(row.linked_committee_current),
      });
    }
  }
  return [...byEmail.values()];
}
function hasGroupProblem(item: GoogleGroupSummary): boolean {
  return (
    item.state !== 'current' ||
    (item.missingCount ?? 0) +
      (item.unexpectedCount ?? 0) +
      (item.unmatchedCount ?? 0) +
      (item.unconfirmedCount ?? 0) >
      0
  );
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
  const rows = await db
    .prepare(
      `${GOOGLE_GROUP_QUERY}
    SELECT v.allowed,s.*,l.committee_id AS linked_committee_id,
      l.name AS linked_committee_name,l.current AS linked_committee_current
    FROM viewer v LEFT JOIN summaries s ON 1=1
    LEFT JOIN committee_links l ON l.group_email=s.group_email
    ORDER BY s.group_email,l.committee_id`,
    )
    .bind(...parameters(actor, query))
    .all<OverviewRow>();
  const first = rows.results[0];
  await requireAllowed(db, actor, first ?? null);
  const allGroups = overviewSummaries(rows.results);
  const committeeGroups = allGroups.filter((item) => !item.isConsole);
  const totalGroups = committeeGroups.length;
  const totalProblems = committeeGroups.filter(hasGroupProblem).length;
  const console = allGroups.find((item) => item.isConsole) ?? null;
  const groups = committeeGroups.filter(
    (item) => item.groupEmail > after && (!query.problemsOnly || hasGroupProblem(item)),
  );
  const items = groups.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: groups.length > limit && last ? accessCursor(['groups', last.groupEmail]) : null,
    console,
    totalGroups,
    totalProblems,
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
      (SELECT json_group_array(json(value)) FROM (SELECT json_object('personId',p.id,'name',coalesce(nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),''),p.email,''),
        'email',p.email,'identityId',d.identity_id,'state',d.state,
        'firstSeenAt',(SELECT first_seen_at FROM access_mismatch_observations mismatch WHERE mismatch.provider='google_workspace' AND mismatch.context_id=(SELECT customer FROM settings) AND mismatch.resource_id=s.group_email AND mismatch.identity_id=d.identity_id AND mismatch.person_id=p.id AND mismatch.expected_access=CASE d.state WHEN 'missing' THEN 1 ELSE 0 END AND mismatch.last_seen_at=s.observed_at),
        'assignmentCommitteeId',CASE WHEN d.state='unexpected' AND p.membership_status='member' THEN (SELECT c.id FROM committees c WHERE c.workspace_group_email=s.group_email AND c.accepting_members=1 LIMIT 1) END,
        'request',json((SELECT json_object('state',o.state,'reviewReason',json_extract(o.payload,'$.googleReview.reason')) FROM integration_outbox o JOIN reconcile_generations g ON g.person_id=o.person_id AND g.target_id='person' AND g.generation=o.generation
          WHERE o.person_id=p.id AND o.target_id='person' AND o.kind='person_reconcile' AND o.state IN ('queued','running','retry','done')
          AND json_extract(o.payload,'$.source')='google_group_review' AND json_extract(o.payload,'$.groupEmail')=s.group_email
          AND json_extract(o.payload,'$.identityId')=d.identity_id AND json_extract(o.payload,'$.customerId')=(SELECT customer FROM settings)
          AND json_extract(o.payload,'$.expectedAccess')=CASE WHEN d.state='missing' THEN 1 ELSE 0 END
          AND (o.state<>'done' OR o.created_at>=s.started_at) ORDER BY o.created_at DESC,o.id DESC LIMIT 1))) AS value FROM differences d JOIN people p ON p.id=d.person_id AND p.deleted_at IS NULL JOIN selected s ON s.group_email=d.group_email AND s.state='current'
        WHERE v.allowed AND p.id>? ORDER BY p.id LIMIT ?)) AS items FROM viewer v`,
    )
    .bind(...parameters(actor, query), query.groupEmail, query.groupEmail, after, limit + 1)
    .first<{ allowed: number; summary: string | null; items: string }>();
  const authorized = await requireAllowed(db, actor, row);
  if (!authorized.summary) return null;
  const people = (JSON.parse(authorized.items) as GroupPersonRow[]).map(groupPerson),
    items = people.slice(0, limit),
    last = items.at(-1);
  return {
    summary: summary(JSON.parse(authorized.summary) as SummaryRow),
    items,
    nextCursor:
      people.length > limit && last ? accessCursor([query.groupEmail, last.personId]) : null,
  };
}
