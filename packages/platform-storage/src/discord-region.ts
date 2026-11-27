import type { AuthEnv } from './auth';
import { discordSessionHash } from './discord-link';

const SESSION = `EXISTS(SELECT 1 FROM sessions s WHERE s.person_id=people.id AND s.id_hash=? AND s.expires_at>?)`;
/** Read the sharing choice only for the exact current session owner. */
export async function discordRegionVisibility(
  env: AuthEnv,
  sessionToken: string,
): Promise<boolean | null> {
  if (!/^[\w-]{43}$/.test(sessionToken)) return null;
  const row = await env.PLATFORM_DB.prepare(
    `SELECT discord_region_visible AS visible FROM people WHERE deleted_at IS NULL AND ${SESSION}`,
  )
    .bind(await discordSessionHash(env, sessionToken), new Date().toISOString())
    .first<{ visible: number }>();
  return row ? row.visible === 1 : null;
}
/** The authority check and preference write share one statement; the trigger queues reconciliation. */
export async function saveDiscordRegionVisibility(
  env: AuthEnv,
  input: { sessionToken: string; personId: string; visible: boolean },
): Promise<boolean> {
  if (!/^[\w-]{43}$/.test(input.sessionToken) || typeof input.visible !== 'boolean') return false;
  const now = new Date().toISOString();
  const result = await env.PLATFORM_DB.prepare(
    `UPDATE people SET discord_region_visible=?,updated_at=? WHERE id=? AND deleted_at IS NULL AND ${SESSION}`,
  )
    .bind(
      Number(input.visible),
      now,
      input.personId,
      await discordSessionHash(env, input.sessionToken),
      now,
    )
    .run();
  return result.meta.changes === 1;
}
