import { isDiscordId } from '@lasvegasfortransit/platform-core/discord-identity';
import { can, PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Actor, Page } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db, SqlValue, Statement } from './db';
import { auditDenied } from './audits';
import { loadActor } from './staff-roles';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { SCAN_CURRENT, scanValues, type DiscordScanLease } from './discord-scan-store';

export interface DiscordRosterMember {
  id: string;
  roleIds: string[];
  pending: boolean;
  bot: boolean;
}

export interface DiscordRosterFlag {
  discordUserId: string;
  roles: Array<{ id: string; label: string }>;
  firstSeenAt: string;
  lastSeenAt: string;
}

function changes(result: unknown): number {
  if (typeof result !== 'object' || result === null || !('meta' in result)) return 0;
  const meta = result.meta;
  if (typeof meta !== 'object' || meta === null || !('changes' in meta)) return 0;
  return typeof meta.changes === 'number' ? meta.changes : 0;
}

interface RecordDiscordRosterPageInput {
  scan: DiscordScanLease;
  members: DiscordRosterMember[];
  memberRoleId: string;
  now: Date;
}

function validateRosterPage({
  scan,
  members,
  memberRoleId,
  now,
}: RecordDiscordRosterPageInput): void {
  if (
    !isDiscordId(scan.guildId) ||
    !isDiscordId(memberRoleId) ||
    !Number.isInteger(members.length) ||
    members.length > 1000 ||
    !Number.isFinite(now.getTime()) ||
    new Set(members.map((member) => member.id)).size !== members.length ||
    !members.every(
      (member) =>
        isDiscordId(member.id) &&
        Array.isArray(member.roleIds) &&
        member.roleIds.length <= 1000 &&
        member.roleIds.every(isDiscordId) &&
        typeof member.pending === 'boolean' &&
        typeof member.bot === 'boolean',
    )
  )
    throw new Error('Invalid Discord roster page');
}

async function loadManagedRoleIds(db: Db, memberRoleId: string): Promise<Set<string>> {
  const { results } = await db
    .prepare("SELECT external_id FROM committee_account_mappings WHERE provider='discord'")
    .all<{ external_id: string }>();
  return new Set([memberRoleId, ...results.map(({ external_id }) => external_id)]);
}

function encodeRosterPage(members: DiscordRosterMember[], managed: Set<string>): string {
  return JSON.stringify(
    members.map((member) => ({
      id: member.id,
      bot: member.bot,
      roles: [...new Set(member.roleIds.filter((roleId) => managed.has(roleId)))].sort(),
    })),
  );
}

function insertRosterFlags(
  db: Db,
  input: { scan: DiscordScanLease; encoded: string; stamp: string; now: Date },
): Statement {
  const { scan, encoded, stamp, now } = input;
  return db
    .prepare(
      `WITH page AS (
        SELECT json_extract(value,'$.id') AS user_id,
          json_extract(value,'$.roles') AS role_ids,
          json_extract(value,'$.bot') AS bot
        FROM json_each(?)
      )
      INSERT INTO discord_role_reviews(guild_id,discord_user_id,managed_role_ids,first_seen_at,last_seen_at,last_seen_scan_id)
      SELECT ?,page.user_id,page.role_ids,?,?,? FROM page
      WHERE page.bot=0 AND json_array_length(page.role_ids)>0
        AND NOT EXISTS(
          SELECT 1 FROM identities i JOIN people p ON p.id=i.person_id AND p.deleted_at IS NULL
          WHERE i.platform='discord' AND i.external_id=page.user_id
            AND i.link_method IN ('self_linked','staff_confirmed')
        )
        AND ${SCAN_CURRENT}
      ON CONFLICT(guild_id,discord_user_id) DO UPDATE SET
        managed_role_ids=excluded.managed_role_ids,
        last_seen_at=excluded.last_seen_at,
        last_seen_scan_id=excluded.last_seen_scan_id`,
    )
    .bind(encoded, scan.guildId, stamp, stamp, scan.startedAt, ...scanValues(scan, now));
}

function clearMissingPageFlags(
  db: Db,
  scan: DiscordScanLease,
  encoded: string,
  now: Date,
): Statement {
  return db
    .prepare(
      `DELETE FROM discord_role_reviews
      WHERE guild_id=? AND discord_user_id IN (SELECT json_extract(value,'$.id') FROM json_each(?))
        AND last_seen_scan_id<>? AND ${SCAN_CURRENT}`,
    )
    .bind(scan.guildId, encoded, scan.startedAt, ...scanValues(scan, now));
}

function clearStaleRosterFlags(db: Db, scan: DiscordScanLease, now: Date): Statement {
  return db
    .prepare(
      `DELETE FROM discord_role_reviews WHERE guild_id=? AND last_seen_scan_id<>? AND ${SCAN_CURRENT}`,
    )
    .bind(scan.guildId, scan.startedAt, ...scanValues(scan, now));
}

function updateRosterCheckpoint(
  db: Db,
  scan: DiscordScanLease,
  input: { nextCursor: string | null; more: boolean; scanned: number; stamp: string; now: Date },
): Statement {
  return db
    .prepare(
      `UPDATE provider_scan_checkpoints SET
        cursor=?,in_progress=?,pages_read=pages_read+1,accounts_read=accounts_read+?,
        unlinked_role_accounts=(SELECT count(*) FROM discord_role_reviews WHERE guild_id=?),
        last_completed_at=CASE WHEN ?=0 THEN ? ELSE last_completed_at END,
        lease_token=NULL,lease_expires_at=NULL
      WHERE provider='discord' AND context_id=? AND ${SCAN_CURRENT}`,
    )
    .bind(
      input.nextCursor,
      Number(input.more),
      input.scanned,
      scan.guildId,
      Number(input.more),
      input.stamp,
      scan.contextId,
      ...scanValues(scan, input.now),
    );
}

/** Save one observed page without changing Discord roles or personal membership. */
export async function recordDiscordRosterPage(
  db: Db,
  input: RecordDiscordRosterPageInput,
): Promise<{ scanned: number; flagged: number; complete: boolean } | null> {
  validateRosterPage(input);
  const { scan, members, memberRoleId, now } = input;
  const managed = await loadManagedRoleIds(db, memberRoleId);
  const encoded = encodeRosterPage(members, managed);
  const stamp = now.toISOString();
  const more = members.length === 1000;
  const nextCursor = more ? (members.at(-1)?.id ?? scan.cursor) : null;
  const statements = [
    insertRosterFlags(db, { scan, encoded, stamp, now }),
    clearMissingPageFlags(db, scan, encoded, now),
  ];
  if (!more) statements.push(clearStaleRosterFlags(db, scan, now));
  statements.push(
    updateRosterCheckpoint(db, scan, { nextCursor, more, scanned: members.length, stamp, now }),
  );

  const result = await db.batch(statements);
  if (!changes(result.at(-1))) return null;
  return { scanned: members.length, flagged: changes(result[0]), complete: !more };
}

export async function recordDiscordRosterScanError(
  db: Db,
  scan: DiscordScanLease,
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE provider_scan_checkpoints SET errors=errors+1
      WHERE provider='discord' AND context_id=? AND ${SCAN_CURRENT}`,
    )
    .bind(scan.contextId, ...scanValues(scan, now))
    .run();
  return result.meta.changes > 0;
}

export interface DiscordRosterReviewQuery {
  guildId: string;
  memberRoleId: string;
  cursor?: string;
  limit?: number;
}

export class InvalidDiscordRosterCursor extends Error {
  constructor() {
    super('Invalid Discord review cursor');
  }
}

function boundedLimit(limit?: number): number {
  return Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit ?? 25))) : 25;
}

/** Return only current review flags that the viewer's current staff scope permits. */
export async function listDiscordRoleReviews(
  db: Db,
  actor: Actor,
  query: DiscordRosterReviewQuery,
): Promise<Page<DiscordRosterFlag>> {
  if (!isDiscordId(query.guildId) || !isDiscordId(query.memberRoleId))
    throw new Error('Invalid Discord review configuration');
  if (query.cursor && !isDiscordId(query.cursor)) throw new InvalidDiscordRosterCursor();
  const current = await loadActor(db, actor.personId);
  if (!current || !can(current, 'access.view')) {
    await auditDenied(db, actor.personId, 'access.view');
    throw new PermissionDenied('access.view');
  }
  const limit = boundedLimit(query.limit),
    scope = `(${STAFF_ADMIN_SCOPE} OR EXISTS(
      SELECT 1 FROM committee_assignments lead JOIN people viewer
        ON viewer.id=lead.person_id AND viewer.deleted_at IS NULL AND viewer.membership_status='member'
      WHERE lead.person_id=? AND lead.role='lead' AND lead.ended_at IS NULL AND lead.committee_id=c.id
    ))`;
  const values: SqlValue[] = [
    actor.personId,
    actor.personId,
    query.memberRoleId,
    actor.personId,
    query.guildId,
  ];
  const cursorClause = query.cursor ? 'AND review.discord_user_id>?' : '';
  if (query.cursor) values.push(query.cursor);
  values.push(limit + 1);
  const { results } = await db
    .prepare(
      `WITH visible_roles AS (
        SELECT mapping.external_id AS role_id,c.name AS label
        FROM committee_account_mappings mapping JOIN committees c ON c.id=mapping.committee_id
        WHERE mapping.provider='discord' AND ${scope}
        UNION ALL
        SELECT ?,'LVBT Member' WHERE ${STAFF_ADMIN_SCOPE}
      )
      SELECT review.discord_user_id AS discordUserId,
        review.first_seen_at AS firstSeenAt,review.last_seen_at AS lastSeenAt,
        (SELECT json_group_array(json_object('id',role_id,'label',label)) FROM (
          SELECT visible.role_id,visible.label FROM visible_roles visible
          WHERE visible.role_id IN (SELECT value FROM json_each(review.managed_role_ids))
          ORDER BY CASE WHEN visible.label='LVBT Member' THEN 0 ELSE 1 END,visible.label,visible.role_id
        )) AS roles
      FROM discord_role_reviews review
      WHERE review.guild_id=? ${cursorClause}
        AND EXISTS(SELECT 1 FROM visible_roles visible WHERE visible.role_id IN (SELECT value FROM json_each(review.managed_role_ids)))
        AND NOT EXISTS(
          SELECT 1 FROM identities i JOIN people p ON p.id=i.person_id AND p.deleted_at IS NULL
          WHERE i.platform='discord' AND i.external_id=review.discord_user_id
            AND i.link_method IN ('self_linked','staff_confirmed')
        )
      ORDER BY review.discord_user_id LIMIT ?`,
    )
    .bind(...values)
    .all<{
      discordUserId: string;
      firstSeenAt: string;
      lastSeenAt: string;
      roles: string;
    }>();
  const items = results.slice(0, limit).map((row) => ({
    ...row,
    roles: JSON.parse(row.roles) as DiscordRosterFlag['roles'],
  }));
  return {
    items,
    nextCursor: results.length > limit ? (items.at(-1)?.discordUserId ?? null) : null,
  };
}
