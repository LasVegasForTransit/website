import type { Actor, Page } from '@lasvegasfortransit/platform-core/staff-types';
import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Db } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditDenied } from './audits';
import { committeeAccessFacts } from './access-view';
import { InvalidCursor } from './staff-history';
import { accessCursor, readAccessCursor, accessPageLimit } from './access-cursors';
import type {
  CommitteeOverviewQuery,
  CommitteeAccessSummary,
  CommitteeDiscordPerson,
} from './committee-access-types';
import { googleSummary } from './committee-access-summary';
import { discordSummary, discordDifferences } from './committee-discord-access';
import { readCommittees, readGroups, readUnlinkedDiscord } from './committee-access-query';
export type {
  CommitteeProviderSummary,
  CommitteeAccessSummary,
  CommitteeOverviewQuery,
  CommitteeDiscordPerson,
} from './committee-access-types';
export async function listCommitteeAccessOverview(
  db: Db,
  actor: Actor,
  query: CommitteeOverviewQuery,
): Promise<Page<CommitteeAccessSummary>> {
  const allowed = await db
    .prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`)
    .bind(actor.personId)
    .first();
  if (!allowed) {
    await auditDenied(db, actor.personId, 'staff_admin.manage');
    throw new PermissionDenied('staff_admin.manage');
  }
  const cursor = readAccessCursor(query.cursor);
  if (cursor && cursor[0] !== 'committees') throw new InvalidCursor();
  const limit = accessPageLimit(query.limit);
  const committees = await readCommittees(db, actor, query, { after: cursor?.[1] ?? '', limit });
  const facts = await committeeAccessFacts(db, actor, {
    configuration: query.configuration,
    now: query.now,
  });
  const groups = await readGroups(db, actor, query);
  const unlinked = await readUnlinkedDiscord(db, actor, query);
  const unlinkedCount = (id: string | null) => unlinked.find((r) => r.roleId === id)?.holders ?? 0;
  const items = committees.slice(0, limit).map((c) => ({
    id: c.id,
    name: c.name,
    expectedPeople: c.expectedPeople,
    google: googleSummary(
      groups.find((group) => group.groupEmail === c.workspace_group_email),
      c.workspace_group_email,
    ),
    discord: discordSummary(
      facts,
      c.discord_role_id,
      query.configuration,
      unlinkedCount(c.discord_role_id),
    ),
    discordLeads: discordSummary(
      facts,
      c.discord_lead_role_id,
      query.configuration,
      unlinkedCount(c.discord_lead_role_id),
    ),
  }));
  const last = items.at(-1);
  return {
    items,
    nextCursor: committees.length > limit && last ? accessCursor(['committees', last.id]) : null,
  };
}
/** Read stored checks only. Shared roles are reviewed against their whole current entitlement. */
export async function listCommitteeDiscordReview(
  db: Db,
  actor: Actor,
  query: CommitteeOverviewQuery & { committeeId: string },
): Promise<Page<CommitteeDiscordPerson>> {
  const overview = await listCommitteeAccessOverview(db, actor, {
    ...query,
    cursor: undefined,
    limit: 1,
  });
  const selected = overview.items[0];
  if (!selected) return { items: [], nextCursor: null };
  const facts = await committeeAccessFacts(db, actor, {
    configuration: query.configuration,
    now: query.now,
  });
  const rows = discordDifferences(facts, selected);
  const cursor = readAccessCursor(query.cursor),
    scope = 'discord:' + query.committeeId;
  if (cursor && cursor[0] !== scope) throw new InvalidCursor();
  const after = cursor?.[1] ?? '',
    limit = accessPageLimit(query.limit);
  const filtered = rows.filter((row) => row.personId + ':' + row.resourceId > after),
    items = filtered.slice(0, limit),
    last = items.at(-1);
  return {
    items,
    nextCursor:
      filtered.length > limit && last
        ? accessCursor([scope, last.personId + ':' + last.resourceId])
        : null,
  };
}
