import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import type { CommitteeOverviewQuery } from './committee-access-types';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { listGoogleGroupOverview, type GoogleGroupSummary } from './google-group-overview';
export async function readCommittees(
  db: Db,
  actor: Actor,
  query: CommitteeOverviewQuery,
  page: { after: string; limit: number },
) {
  const { results } = await db
    .prepare(
      `SELECT id,name,workspace_group_email,discord_role_id,discord_lead_role_id,
 (SELECT count(DISTINCT a.person_id) FROM committee_assignments a JOIN people p ON p.id=a.person_id WHERE a.committee_id=c.id AND a.ended_at IS NULL AND p.deleted_at IS NULL AND p.membership_status='member') AS expectedPeople
 FROM committees c WHERE ${STAFF_ADMIN_SCOPE} AND id>? AND (? IS NULL OR id=?) AND (? OR workspace_group_email IS NOT NULL OR discord_role_id IS NOT NULL OR discord_lead_role_id IS NOT NULL) ORDER BY id LIMIT ?`,
    )
    .bind(
      actor.personId,
      page.after,
      query.committeeId ?? null,
      query.committeeId ?? null,
      Number(!!query.includeUnmapped || !!query.committeeId),
      page.limit + 1,
    )
    .all<{
      id: string;
      name: string;
      workspace_group_email: string | null;
      discord_role_id: string | null;
      discord_lead_role_id: string | null;
      expectedPeople: number;
    }>();
  return results;
}
export async function readGroups(db: Db, actor: Actor, query: CommitteeOverviewQuery) {
  const groups: GoogleGroupSummary[] = [];
  let groupCursor: string | undefined;
  do {
    const page = await listGoogleGroupOverview(db, actor, {
      configuration: query.configuration.google_workspace ?? { configured: false, contextId: '' },
      consoleGroupEmail: query.consoleGroupEmail,
      now: query.now,
      problemsOnly: false,
      limit: 100,
      ...(groupCursor ? { cursor: groupCursor } : {}),
    });
    groups.push(...page.items);
    groupCursor = page.nextCursor ?? undefined;
  } while (groupCursor);
  return groups;
}
export async function readUnlinkedDiscord(db: Db, actor: Actor, query: CommitteeOverviewQuery) {
  const { results } = await db
    .prepare(
      `SELECT value AS roleId,count(DISTINCT r.discord_user_id) AS holders FROM discord_role_reviews r,json_each(r.managed_role_ids)
 WHERE r.guild_id=? AND r.last_seen_at>? AND r.last_seen_at<=? AND ${STAFF_ADMIN_SCOPE}
 AND NOT EXISTS(SELECT 1 FROM identities i JOIN people p ON p.id=i.person_id AND p.deleted_at IS NULL WHERE i.platform='discord' AND i.external_id=r.discord_user_id AND i.link_method IN ('self_linked','staff_confirmed')) GROUP BY value`,
    )
    .bind(
      query.configuration.discord?.contextId ?? '',
      new Date(query.now.getTime() - 300000).toISOString(),
      query.now.toISOString(),
      actor.personId,
    )
    .all<{ roleId: string; holders: number }>();
  return results;
}
