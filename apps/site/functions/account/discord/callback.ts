/// <reference types="@cloudflare/workers-types" />
import { readCookie, SESSION_COOKIE } from '@lasvegasfortransit/platform-core/web-auth';
import { DiscordLink } from '@lasvegasfortransit/platform-integrations/discord-link';
import type { SignInPagesEnv } from '../../sign-in/_shared';
import {
  discordPlatform,
  discordReply,
  discordStateCookie,
  DISCORD_STATE_COOKIE,
} from './_discord';
export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const url = new URL(request.url),
    state = url.searchParams.get('state'),
    sessionToken = readCookie(request, SESSION_COOKIE);
  const platform = discordPlatform(env);
  let linked = false;
  if (
    platform &&
    sessionToken &&
    state &&
    state === readCookie(request, DISCORD_STATE_COOKIE) &&
    !url.searchParams.has('error')
  ) {
    try {
      linked = await new DiscordLink(platform).callback({
        sessionToken,
        state,
        origin: url.origin,
        code: url.searchParams.get('code') ?? '',
      });
    } catch {
      /* The one-use flow is consumed; a fresh attempt is required. */
    }
  }
  return discordReply(null, 303, {
    Location: linked ? '/account/#discord' : '/account/discord/?result=failed',
    'Set-Cookie': discordStateCookie(''),
  });
};
