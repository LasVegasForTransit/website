import { SESSION_COOKIE, readCookie, safeNext } from '@lasvegasfortransit/platform-core/web-auth';
import { readStaffSession } from './staff-session';
import { staffDiscordReadiness } from '@lasvegasfortransit/platform-storage/staff-discord-handoff';
import type { StaffEnv } from './context';
import type { AccessIdentity } from '@lasvegasfortransit/platform-integrations/access-identity';
export const CONNECTION_COOKIE = '__Host-lvbt_workspace_connection';
export const DISCORD_HANDOFF_COOKIE = '__Host-lvbt_staff_discord';
export function onboardingCookie(name: string, value: string) {
  return `${name}=${value}; Path=/; Max-Age=${value ? 600 : 0}; HttpOnly; Secure; SameSite=Lax`;
}
export async function onboardingAccount(env: StaffEnv, request: Request, access?: AccessIdentity) {
  const session = await readStaffSession(env, request, access),
    token = readCookie(request, SESSION_COOKIE);
  if (!session || !token) return null;
  const url = new URL(request.url);
  const requestedNext = safeNext(url.searchParams.get('next'));
  return {
    session,
    token,
    next: /^\/(?:onboarding|sign-in|sign-out)(?:\/|\?|$)/.test(requestedNext) ? '/' : requestedNext,
    staffOrigin: url.origin,
    memberOrigin:
      env.LVBT_MEMBER_ORIGIN ??
      (url.hostname.includes('preview')
        ? 'https://preview.lasvegasfortransit.org'
        : 'https://lasvegasfortransit.org'),
  };
}

export function onboardingStepPath(
  step: 'pending' | 'account' | 'discord' | 'screening' | 'ready',
  next: string,
) {
  return `/onboarding/${step === 'screening' ? 'discord/screening' : step}/?next=${encodeURIComponent(next)}`;
}
export async function refreshOnboardingDiscord(env: StaffEnv, personId: string) {
  if (!env.LVBT_NEWSLETTER_JOBS) return false;
  try {
    const response = await env.LVBT_NEWSLETTER_JOBS.fetch(
      new Request('https://jobs.internal/discord/readiness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId, environment: env.LVBT_DEPLOYMENT_ENV }),
      }),
    );
    const result: { kind?: string } = await response.json();
    return response.ok && result.kind === 'observed';
  } catch {
    return false;
  }
}

/** Refresh only a previously verified, expired guild observation. */
export async function refreshExpiredOnboardingDiscord(
  env: StaffEnv,
  personId: string,
  guildId: string,
) {
  const cached = await staffDiscordReadiness(env, personId, guildId);
  if (!cached?.expired || cached.identity_count !== 1 || !cached.discord_id || cached.disconnecting)
    return false;
  return refreshOnboardingDiscord(env, personId);
}
