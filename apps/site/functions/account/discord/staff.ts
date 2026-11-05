import { recovery } from '../../sign-in/staff-link/index';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import { SESSION_COOKIE, readCookie } from '@lasvegasfortransit/platform-core/web-auth';
import { readSession } from '@lasvegasfortransit/platform-storage/auth';
import {
  staffDiscordHandoff,
  bindStaffDiscordBrowser,
  consumeStaffDiscordHandoff,
} from '@lasvegasfortransit/platform-storage/staff-discord-handoff';
import { DiscordLink } from '@lasvegasfortransit/platform-integrations/discord-link';
import { discordPlatform, discordReply, discordStateCookie } from './_discord';
import { STAFF_DISCORD_BROWSER, STAFF_DISCORD_SESSION, staffDiscordCookie } from './_staff';
import type { SignInPagesEnv } from '../../sign-in/_shared';
export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const platform = discordPlatform(env),
    url = new URL(request.url),
    ticket = url.searchParams.get('request') ?? '';
  if (!platform)
    return recovery(
      env,
      request,
      503,
      'Discord setup is temporarily unavailable. Try again later.',
    );
  const handoff = await staffDiscordHandoff(platform, ticket);
  if (handoff?.member_origin !== url.origin)
    return recovery(env, request, 410, 'This connection expired. Start again from the portal.');
  const accountToken = readCookie(request, SESSION_COOKIE),
    account = accountToken ? await readSession(platform, accountToken) : null;
  if (account && account.personId !== handoff.person_id)
    return recovery(
      env,
      request,
      409,
      'A different LVBT account is signed in. Sign out of the member site, then try again.',
    );
  const browser = readCookie(request, STAFF_DISCORD_BROWSER) ?? randomToken();
  if (!url.searchParams.has('finish')) {
    if (!(await bindStaffDiscordBrowser(platform, ticket, browser)))
      return recovery(
        env,
        request,
        409,
        'This connection belongs to another browser. Start again from the portal.',
      );
    return discordReply(null, 303, {
      Location: `${handoff.staff_origin}/onboarding/discord/?browser=${encodeURIComponent(browser)}`,
      'Set-Cookie': staffDiscordCookie(STAFF_DISCORD_BROWSER, browser),
    });
  }
  const session = await consumeStaffDiscordHandoff(platform, ticket, browser, {
    approval: url.searchParams.get('approval') ?? '',
  });
  if (!session)
    return recovery(env, request, 410, 'This connection expired. Start again from the portal.');
  const client = new DiscordLink(platform),
    csrf = await client.formToken(session.token, url.origin);
  const started = csrf
    ? await client.start({ sessionToken: session.token, origin: url.origin, csrfToken: csrf })
    : null;
  if (!started)
    return recovery(
      env,
      request,
      503,
      'Discord setup is temporarily unavailable. Try again later.',
    );
  const response = discordReply(null, 303, {
    Location: started.url,
    'Set-Cookie': staffDiscordCookie(STAFF_DISCORD_SESSION, session.token),
  });
  response.headers.append('Set-Cookie', discordStateCookie(started.state));
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
};
