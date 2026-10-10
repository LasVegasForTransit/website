/// <reference types="@cloudflare/workers-types" />
import {
  DiscordLink,
  discordLinkConfigured,
  type DiscordLinkEnv,
} from '@lasvegasfortransit/platform-integrations/discord-link';
import {
  discordLinkOrigin,
  DiscordLinkService,
} from '@lasvegasfortransit/platform-storage/discord-link';
import { SESSION_COOKIE, readCookie } from '@lasvegasfortransit/platform-core/web-auth';
import { requireMember, signInEnv, signInRedirect } from '../../../platform/sign-in';
import type { SignInPagesEnv } from '../../sign-in/_shared';
import { finish } from '../../join/_page';
export const DISCORD_STATE_COOKIE = '__Host-lvbt_discord_state';
export function discordStateCookie(value: string): string {
  return `${DISCORD_STATE_COOKIE}=${value}; Path=/; Max-Age=${value ? 600 : 0}; HttpOnly; Secure; SameSite=Lax`;
}
export function discordPlatform(env: SignInPagesEnv): DiscordLinkEnv | null {
  const base = signInEnv(env);
  return base
    ? {
        ...base,
        LVBT_DISCORD_APPLICATION_ID: env.LVBT_DISCORD_APPLICATION_ID,
        LVBT_DISCORD_CLIENT_SECRET: env.LVBT_DISCORD_CLIENT_SECRET,
      }
    : null;
}
export function discordReply(
  body: string | null,
  status: number,
  headers: HeadersInit = {},
): Response {
  const response = finish(
    new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }),
    status,
    headers,
  );
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export async function discordMember(env: SignInPagesEnv, request: Request) {
  if (!discordLinkOrigin(new URL(request.url).origin))
    return discordReply('This connection is not available at this address.', 403);
  const platform = discordPlatform(env);
  const sessionToken = readCookie(request, SESSION_COOKIE);
  if (!platform || !sessionToken) return signInRedirect(request, false);
  if (!discordLinkConfigured(platform))
    return discordReply('Connecting Discord is unavailable. Please try again later.', 503);
  const signed = await requireMember(platform, request);
  if (signed instanceof Response) return signed;
  const profile = await new DiscordLinkService(platform).profile(sessionToken);
  if (!profile)
    return discordReply(
      'Only current LVBT members can connect Discord. Check your membership on your account page.',
      409,
    );
  return { platform, sessionToken, profile, client: new DiscordLink(platform) };
}
