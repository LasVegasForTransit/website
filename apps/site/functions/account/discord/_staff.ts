import { readCookie } from '@lasvegasfortransit/platform-core/web-auth';
import { staffDiscordSession } from '@lasvegasfortransit/platform-storage/staff-discord-handoff';
import type { AuthEnv } from '@lasvegasfortransit/platform-storage/auth';
export const STAFF_DISCORD_BROWSER = '__Host-lvbt_staff_discord_browser';
export const STAFF_DISCORD_SESSION = '__Host-lvbt_staff_discord_session';
export function staffDiscordCookie(name: string, value: string) {
  return `${name}=${value}; Path=/; Max-Age=${value ? 600 : 0}; HttpOnly; Secure; SameSite=Lax`;
}
export async function scopedDiscordSession(env: AuthEnv, request: Request) {
  const token = readCookie(request, STAFF_DISCORD_SESSION);
  if (!token) return null;
  const current = await staffDiscordSession(env, token);
  return current ? { token, ...current } : null;
}
