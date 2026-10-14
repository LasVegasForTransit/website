import { noticeCookie } from '../_account';
import { readCookie, SESSION_COOKIE } from '@lasvegasfortransit/platform-core/web-auth';
import {
  DiscordLink,
  type DiscordLinkEnv,
} from '@lasvegasfortransit/platform-integrations/discord-link';
import type { DiscordJoinResult } from '@lasvegasfortransit/platform-integrations/discord-join';
import { discordReply, discordStateCookie, DISCORD_STATE_COOKIE } from './_discord';

export async function completeDiscordConnection(
  platform: DiscordLinkEnv | null,
  request: Request,
  options: ConstructorParameters<typeof DiscordLink>[1] = {},
): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const sessionToken = readCookie(request, SESSION_COOKIE);
  let result: DiscordJoinResult = { kind: 'failed' };
  if (
    platform &&
    sessionToken &&
    state &&
    state === readCookie(request, DISCORD_STATE_COOKIE) &&
    !url.searchParams.has('error')
  ) {
    try {
      result = await new DiscordLink(platform, options).callback({
        sessionToken,
        state,
        origin: url.origin,
        code: url.searchParams.get('code') ?? '',
      });
    } catch {
      /* A fresh authorization attempt is required after a consumed flow. */
    }
  }
  const response = discordReply(null, 303, {
    Location:
      result.kind === 'connected' ? '/account/#discord' : `/account/discord/?result=${result.kind}`,
    'Set-Cookie': discordStateCookie(''),
  });
  if (result.kind === 'connected')
    response.headers.append('Set-Cookie', noticeCookie('discord_connected'));
  return response;
}
