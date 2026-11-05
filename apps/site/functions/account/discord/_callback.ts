import { scopedDiscordSession, STAFF_DISCORD_SESSION, staffDiscordCookie } from './_staff';
import { noticeCookie } from '../_account';
import { readCookie, SESSION_COOKIE } from '@lasvegasfortransit/platform-core/web-auth';
import {
  DiscordLink,
  DiscordApiFailure,
  type DiscordLinkEnv,
  type DiscordConnectionResult,
} from '@lasvegasfortransit/platform-integrations/discord-link';
import { discordReply, discordStateCookie, DISCORD_STATE_COOKIE } from './_discord';

async function authorizationResult(
  client: DiscordLink,
  input: { sessionToken: string; state: string; origin: string },
  url: URL,
): Promise<DiscordConnectionResult> {
  try {
    if (!url.searchParams.has('error'))
      return await client.callback({ ...input, code: url.searchParams.get('code') ?? '' });
    if (!(await client.cancel(input))) return { kind: 'failed' };
    const error = url.searchParams.get('error');
    if (error === 'access_denied') return { kind: 'cancelled' };
    if (['server_error', 'temporarily_unavailable'].includes(error ?? ''))
      return { kind: 'unavailable' };
  } catch (error) {
    /* A fresh authorization attempt is required after a consumed flow. */
    if (
      error instanceof DiscordApiFailure &&
      ['provider_unavailable', 'rate_limited'].includes(error.kind)
    )
      return { kind: 'unavailable' };
  }
  return { kind: 'failed' };
}

function connectionDestination(
  scoped: Awaited<ReturnType<typeof scopedDiscordSession>>,
  result: DiscordConnectionResult,
) {
  if (scoped) {
    const destination = new URL(scoped.return_to, scoped.staff_origin);
    destination.searchParams.set('discord', result.kind);
    return destination.href;
  }
  return ['connected', 'cancelled'].includes(result.kind)
    ? '/account/#discord'
    : `/account/discord/?result=${result.kind}`;
}
function connectionCookies(
  response: Response,
  result: DiscordConnectionResult,
  stateMatches: boolean,
  scoped: boolean,
) {
  if (stateMatches && result.kind !== 'failed')
    response.headers.append('Set-Cookie', discordStateCookie(''));
  if (scoped) response.headers.append('Set-Cookie', staffDiscordCookie(STAFF_DISCORD_SESSION, ''));
  if (result.kind === 'connected')
    response.headers.append('Set-Cookie', noticeCookie('discord_connected'));
  if (result.kind === 'cancelled')
    response.headers.append('Set-Cookie', noticeCookie('discord_cancelled'));
  return response;
}
export async function completeDiscordConnection(
  platform: DiscordLinkEnv | null,
  request: Request,
  options: ConstructorParameters<typeof DiscordLink>[1] = {},
): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const scoped = platform ? await scopedDiscordSession(platform, request) : null;
  const sessionToken = scoped?.token ?? readCookie(request, SESSION_COOKIE);
  const stateMatches = Boolean(state && state === readCookie(request, DISCORD_STATE_COOKIE));
  let result: DiscordConnectionResult = { kind: 'failed' };
  if (platform && sessionToken && state && stateMatches) {
    result = await authorizationResult(
      new DiscordLink(platform, options),
      { sessionToken, state, origin: url.origin },
      url,
    );
  }
  const response = discordReply(null, 303, { Location: connectionDestination(scoped, result) });
  return connectionCookies(response, result, stateMatches, Boolean(scoped));
}
