import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { AccessConfiguration } from '@lasvegasfortransit/platform-core/access';
import type { Db } from './db';
import { STAFF_PERSON_SCOPE } from './staff-scope';
import { MEMBER_SINCE, UNWELCOMED, WELCOME_SCOPE } from './welcome-scope';
export interface RosterDetails {
  committees: string[];
  discordConnected: boolean;
  discordInServer: boolean | null;
  welcome: { claimedBy: string | null; claimedByName: string | null } | null;
}
export interface RosterDetailsOptions {
  configuration?: AccessConfiguration;
  now?: Date;
}
export async function rosterDetails(
  db: Db,
  actor: Actor,
  personIds: string[],
  options: RosterDetailsOptions = {},
) {
  const configuration = options.configuration ?? {};
  const now = options.now ?? new Date();
  const ids = [...new Set(personIds)].slice(0, 200);
  if (!ids.length) return new Map<string, RosterDetails>();
  const oldest = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT p.id,
    (SELECT json_group_array(name) FROM (SELECT c.name FROM committee_assignments a JOIN committees c ON c.id=a.committee_id WHERE a.person_id=p.id AND a.ended_at IS NULL ORDER BY c.name)) AS committees,
    EXISTS(SELECT 1 FROM identities i WHERE i.person_id=p.id AND i.platform='discord' AND i.link_method IN ('self_linked','staff_confirmed')) AS discord_connected,
    (SELECT CASE WHEN d.expires_at>? AND d.observed_at<=? THEN d.in_guild ELSE NULL END
      FROM identities i JOIN discord_profiles d ON d.identity_record_id=i.id
      WHERE i.person_id=p.id AND i.platform='discord' AND i.link_method IN ('self_linked','staff_confirmed')
        AND d.guild_id=? AND (SELECT count(*) FROM identities WHERE person_id=p.id AND platform='discord')=1
      LIMIT 1) AS discord_in_server,
    (p.membership_status='member' AND ${WELCOME_SCOPE} AND ${UNWELCOMED}
      AND ((julianday(${MEMBER_SINCE})>=julianday(?) AND julianday(${MEMBER_SINCE})<=julianday(?))
      OR (claim.actor_id=? AND claim.expires_at>?))) AS welcome_pending,
    claim.actor_id AS claimed_by,
    NULLIF(trim(coalesce(claimant.given_name,'') || ' ' || coalesce(claimant.family_name,'')),'') AS claimed_by_name
    FROM people p LEFT JOIN welcome_claims claim ON claim.person_id=p.id AND claim.expires_at>?
    LEFT JOIN people claimant ON claimant.id=claim.actor_id AND claimant.deleted_at IS NULL
    WHERE p.id IN (${ids.map(() => '?').join(',')}) AND p.deleted_at IS NULL AND ${STAFF_PERSON_SCOPE}`,
    )
    .bind(
      now.toISOString(),
      now.toISOString(),
      configuration.discord?.configured ? configuration.discord.contextId : '',
      actor.personId,
      oldest,
      now.toISOString(),
      actor.personId,
      now.toISOString(),
      now.toISOString(),
      ...ids,
      actor.personId,
    )
    .all<{
      id: string;
      committees: string;
      discord_connected: number;
      discord_in_server: number | null;
      welcome_pending: number;
      claimed_by: string | null;
      claimed_by_name: string | null;
    }>();
  return new Map(
    results.map((row) => [
      row.id,
      {
        committees: JSON.parse(row.committees) as string[],
        discordConnected: Boolean(row.discord_connected),
        discordInServer: row.discord_in_server === null ? null : Boolean(row.discord_in_server),
        welcome: row.welcome_pending
          ? { claimedBy: row.claimed_by, claimedByName: row.claimed_by_name }
          : null,
      },
    ]),
  );
}
