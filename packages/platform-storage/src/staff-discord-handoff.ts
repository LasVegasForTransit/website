import { digestToken, randomToken } from '@lasvegasfortransit/platform-core/random-token';
import { safeNext } from '@lasvegasfortransit/platform-core/web-auth';
import type { AuthEnv } from './auth';
import {
  LIVE_ENROLLED_STAFF,
  onboardingOrigins,
  workspaceSessionHash,
} from './workspace-enrollment-connect';
const ticketHash = (token: string) => digestToken(`staff-discord:${token}`);
const browserHash = (token: string) => digestToken(`staff-discord-browser:${token}`);
const approvalHash = (token: string) => digestToken(`staff-discord-approval:${token}`);
interface Handoff {
  staff_origin: string;
  member_origin: string;
  return_to: string;
  person_id: string;
  browser_hash: string | null;
  approved_at: string | null;
}
const LIVE_HANDOFF = `EXISTS(SELECT 1 FROM sessions s JOIN people p ON p.id=s.person_id
 JOIN workspace_enrollments e ON e.person_id=p.id WHERE s.id_hash=h.staff_session_hash
 AND p.id=h.person_id AND e.identity_record_id=h.identity_record_id AND ${LIVE_ENROLLED_STAFF})`;
export async function beginStaffDiscordHandoff(
  env: AuthEnv,
  staffToken: string,
  input: { staffOrigin: string; memberOrigin: string; returnTo: string; now?: Date },
) {
  if (!onboardingOrigins(input.staffOrigin, input.memberOrigin)) return null;
  const now = input.now ?? new Date(),
    token = randomToken();
  await env.PLATFORM_DB.prepare(
    `INSERT INTO staff_discord_handoffs(token_hash,staff_session_hash,person_id,identity_record_id,staff_origin,member_origin,return_to,expires_at)
 SELECT ?,s.id_hash,p.id,e.identity_record_id,?,?,?,? FROM sessions s JOIN people p ON p.id=s.person_id JOIN workspace_enrollments e ON e.person_id=p.id
 WHERE s.id_hash=? AND ${LIVE_ENROLLED_STAFF}`,
  )
    .bind(
      await ticketHash(token),
      input.staffOrigin,
      input.memberOrigin,
      safeNext(input.returnTo),
      new Date(now.getTime() + 600_000).toISOString(),
      await workspaceSessionHash(env, staffToken),
      now.toISOString(),
    )
    .run();
  return (await staffDiscordHandoff(env, token, now)) ? token : null;
}
export async function staffDiscordHandoff(env: AuthEnv, token: string, now = new Date()) {
  if (!/^[\w-]{43}$/.test(token)) return null;
  return env.PLATFORM_DB.prepare(
    `SELECT h.staff_origin,h.member_origin,h.return_to,h.person_id,h.browser_hash,h.approved_at
 FROM staff_discord_handoffs h WHERE h.token_hash=? AND h.expires_at>? AND h.consumed_at IS NULL AND ${LIVE_HANDOFF}`,
  )
    .bind(await ticketHash(token), now.toISOString(), now.toISOString())
    .first<Handoff>();
}
/** First public navigation binds the ticket to a host-only random browser cookie. */
export async function bindStaffDiscordBrowser(
  env: AuthEnv,
  token: string,
  browser: string,
  now = new Date(),
) {
  if (!/^[\w-]{43}$/.test(browser) || !(await staffDiscordHandoff(env, token, now))) return false;
  const hash = await browserHash(browser);
  const row = await env.PLATFORM_DB.prepare(
    `UPDATE staff_discord_handoffs SET browser_hash=? WHERE token_hash=?
 AND expires_at>? AND consumed_at IS NULL AND (browser_hash IS NULL OR browser_hash=?) RETURNING token_hash`,
  )
    .bind(hash, await ticketHash(token), now.toISOString(), hash)
    .first();
  return Boolean(row);
}
/** Complete the expiring intent created by the same-origin Connect POST.
 * The caller must take the ticket from the host-only staff cookie. The fresh
 * capability is delivered only to that browser and still needs its public cookie.
 */
export async function approveStaffDiscordHandoff(
  env: AuthEnv,
  token: string,
  input: { staffToken: string; browser: string; now?: Date },
) {
  const { staffToken, browser } = input,
    now = input.now ?? new Date();
  if (!/^[\w-]{43}$/.test(browser) || !(await staffDiscordHandoff(env, token, now))) return null;
  const approval = randomToken();
  const row = await env.PLATFORM_DB.prepare(
    `UPDATE staff_discord_handoffs SET approved_at=?,approval_hash=? WHERE token_hash=?
 AND staff_session_hash=? AND browser_hash=? AND expires_at>? AND consumed_at IS NULL AND approved_at IS NULL RETURNING token_hash`,
  )
    .bind(
      now.toISOString(),
      await approvalHash(approval),
      await ticketHash(token),
      await workspaceSessionHash(env, staffToken),
      await browserHash(browser),
      now.toISOString(),
    )
    .first();
  return row ? approval : null;
}
/** Issues only a Discord-scoped session, never the public site's account cookie. */
export async function consumeStaffDiscordHandoff(
  env: AuthEnv,
  token: string,
  browser: string,
  proof: { approval?: string; now?: Date } = {},
) {
  const now = proof.now ?? new Date(),
    approval = proof.approval ?? '';
  if (
    !/^[\w-]{43}$/.test(browser) ||
    !/^[\w-]{43}$/.test(approval) ||
    !(await staffDiscordHandoff(env, token, now))
  )
    return null;
  const publicToken = randomToken(),
    hash = await workspaceSessionHash(env, publicToken),
    stamp = now.toISOString();
  await env.PLATFORM_DB.batch([
    env.PLATFORM_DB.prepare(
      `INSERT INTO sessions(id_hash,person_id,type,created_at,last_used_at,expires_at,updated_at)
  SELECT ?,h.person_id,'staff',?,?,h.expires_at,? FROM staff_discord_handoffs h
  WHERE h.token_hash=? AND h.browser_hash=? AND h.approval_hash=? AND h.approved_at IS NOT NULL AND h.expires_at>?
  AND h.consumed_at IS NULL AND ${LIVE_HANDOFF}`,
    ).bind(
      hash,
      stamp,
      stamp,
      stamp,
      await ticketHash(token),
      await browserHash(browser),
      await approvalHash(approval),
      stamp,
      stamp,
    ),
    env.PLATFORM_DB.prepare(
      `UPDATE staff_discord_handoffs SET consumed_at=?,public_session_hash=?,approval_hash=NULL WHERE token_hash=?
  AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM sessions WHERE id_hash=?)`,
    ).bind(stamp, hash, await ticketHash(token), hash),
  ]);
  const current = await staffDiscordSession(env, publicToken, now);
  return current ? { token: publicToken, ...current } : null;
}
export async function staffDiscordSession(env: AuthEnv, token: string, now = new Date()) {
  if (!/^[\w-]{43}$/.test(token)) return null;
  return env.PLATFORM_DB.prepare(
    `SELECT h.staff_origin,h.return_to,h.person_id FROM staff_discord_handoffs h
 JOIN sessions public ON public.id_hash=h.public_session_hash AND public.person_id=h.person_id
 WHERE h.public_session_hash=? AND public.expires_at>? AND h.expires_at>? AND h.consumed_at IS NOT NULL AND ${LIVE_HANDOFF}`,
  )
    .bind(
      await workspaceSessionHash(env, token),
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
    )
    .first<{ staff_origin: string; return_to: string; person_id: string }>();
}

export async function deferStaffDiscord(env: AuthEnv, personId: string, now = new Date()) {
  await env.PLATFORM_DB.prepare(
    `INSERT INTO workspace_onboarding_choices(person_id,discord_deferred_at) VALUES(?,?)
 ON CONFLICT(person_id) DO UPDATE SET discord_deferred_at=excluded.discord_deferred_at`,
  )
    .bind(personId, now.toISOString())
    .run();
}
export async function staffDiscordReadiness(
  env: AuthEnv,
  personId: string,
  guildId: string,
  now = new Date(),
) {
  return env.PLATFORM_DB.prepare(
    `SELECT
 (SELECT discord_deferred_at FROM workspace_onboarding_choices WHERE person_id=p.id) AS deferred_at,
 EXISTS(SELECT 1 FROM staff_audits WHERE target_id=p.id AND action='identity.discord_disconnect') AS disconnected,
 (SELECT count(*) FROM identities WHERE person_id=p.id AND platform='discord') AS identity_count,
 EXISTS(SELECT 1 FROM identities i JOIN discord_profiles d ON d.identity_record_id=i.id
 WHERE i.person_id=p.id AND i.platform='discord' AND i.link_method IN ('self_linked','staff_confirmed')
 AND d.guild_id=? AND d.in_guild=1 AND d.observed_at<=? AND d.expires_at<=?) AS expired,
 (SELECT external_id FROM identities WHERE person_id=p.id AND platform='discord' AND link_method IN ('self_linked','staff_confirmed') LIMIT 1) AS discord_id,
 EXISTS(SELECT 1 FROM discord_disconnects d JOIN identities i ON i.id=d.identity_record_id WHERE i.person_id=p.id) AS disconnecting,
 EXISTS(SELECT 1 FROM identities i JOIN discord_profiles d ON d.identity_record_id=i.id
 WHERE i.person_id=p.id AND i.platform='discord' AND i.link_method IN ('self_linked','staff_confirmed') AND d.in_guild=1 AND d.guild_id=? AND d.expires_at>?) AS in_guild,
 EXISTS(SELECT 1 FROM identities i JOIN discord_profiles d ON d.identity_record_id=i.id WHERE i.person_id=p.id AND i.platform='discord' AND d.in_guild=1 AND d.pending=1 AND d.guild_id=? AND d.expires_at>?) AS screening
 FROM people p WHERE p.id=? AND p.deleted_at IS NULL`,
  )
    .bind(
      guildId,
      now.toISOString(),
      now.toISOString(),
      guildId,
      now.toISOString(),
      guildId,
      now.toISOString(),
      personId,
    )
    .first<{
      deferred_at: string | null;
      discord_id: string | null;
      disconnected: number;
      identity_count: number;
      expired: number;
      disconnecting: number;
      in_guild: number;
      screening: number;
    }>();
}

export type StaffOnboardingStep = 'pending' | 'account' | 'discord' | 'screening' | 'ready';
export async function chooseWorkspaceAccount(env: AuthEnv, staffToken: string, now = new Date()) {
  const row = await env.PLATFORM_DB.prepare(
    `INSERT INTO staff_onboarding_sessions(staff_session_hash,person_id,identity_record_id,account_chosen_at)
 SELECT s.id_hash,p.id,e.identity_record_id,? FROM sessions s JOIN people p ON p.id=s.person_id
 JOIN workspace_enrollments e ON e.person_id=p.id WHERE s.id_hash=? AND ${LIVE_ENROLLED_STAFF}
 ON CONFLICT(staff_session_hash) DO UPDATE SET account_chosen_at=excluded.account_chosen_at RETURNING staff_session_hash`,
  )
    .bind(now.toISOString(), await workspaceSessionHash(env, staffToken), now.toISOString())
    .first();
  return Boolean(row);
}
export async function staffOnboardingStep(
  env: AuthEnv,
  staffToken: string,
  guildId: string,
  now = new Date(),
): Promise<StaffOnboardingStep> {
  const current = await env.PLATFORM_DB.prepare(
    `SELECT p.id,e.provisional,
 EXISTS(SELECT 1 FROM staff_onboarding_sessions c WHERE c.staff_session_hash=s.id_hash AND c.person_id=p.id AND c.identity_record_id=e.identity_record_id) AS chosen
 FROM sessions s JOIN people p ON p.id=s.person_id JOIN workspace_enrollments e ON e.person_id=p.id
 WHERE s.id_hash=? AND ${LIVE_ENROLLED_STAFF}`,
  )
    .bind(await workspaceSessionHash(env, staffToken), now.toISOString())
    .first<{ id: string; provisional: number; chosen: number }>();
  if (!current) return 'pending';
  if (current.provisional && !current.chosen) return 'account';
  const discord = await staffDiscordReadiness(env, current.id, guildId, now);
  if (
    discord?.identity_count !== 1 ||
    !discord.discord_id ||
    discord.disconnecting ||
    !discord.in_guild
  )
    return 'discord';
  return discord.screening ? 'screening' : 'ready';
}
