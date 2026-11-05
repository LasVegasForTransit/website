import type { AuthEnv } from './auth';
import { readSession } from './auth';
import { workspaceSessionHash } from './workspace-enrollment-connect';
import { staffDiscordSession } from './staff-discord-handoff';
/** Joining is independent of the explicit Member and committee-role plans. */
export const DISCORD_PERSON_ELIGIBLE = `(p.membership_status='member' OR EXISTS(
 SELECT 1 FROM workspace_enrollments e WHERE e.person_id=p.id AND e.state='active'))`;
/** A scoped public session also depends on the original live organization proof. */
export const DISCORD_SESSION_ELIGIBLE = `NOT EXISTS(SELECT 1 FROM staff_discord_handoffs h WHERE h.public_session_hash=s.id_hash
 AND (h.expires_at<=? OR NOT EXISTS(SELECT 1 FROM sessions staff JOIN workspace_enrollments e ON e.person_id=staff.person_id
 WHERE staff.id_hash=h.staff_session_hash AND staff.person_id=h.person_id AND staff.expires_at>?
 AND e.state='active' AND e.identity_record_id=h.identity_record_id AND (staff.workspace_identity_id=e.identity_record_id OR
 EXISTS(SELECT 1 FROM staff_sso_links l WHERE l.id=staff.sso_link_id AND l.person_id=staff.person_id AND l.revoked_at IS NULL)))))`;
export async function discordSessionEligible(env: AuthEnv, token: string, now = new Date()) {
  const session = await readSession(env, token, now);
  if (!session) return false;
  const scoped = await env.PLATFORM_DB.prepare(
    'SELECT 1 FROM staff_discord_handoffs WHERE public_session_hash=?',
  )
    .bind(await workspaceSessionHash(env, token))
    .first();
  if (scoped && !(await staffDiscordSession(env, token, now))) return false;
  return Boolean(
    await env.PLATFORM_DB.prepare(
      `SELECT 1 FROM people p WHERE p.id=? AND p.deleted_at IS NULL AND ${DISCORD_PERSON_ELIGIBLE}`,
    )
      .bind(session.personId)
      .first(),
  );
}
