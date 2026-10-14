/// <reference types="@cloudflare/workers-types" />
import { DiscordDisconnect } from '@lasvegasfortransit/platform-integrations/discord-disconnect';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { SESSION_COOKIE, readCookie } from '@lasvegasfortransit/platform-core/web-auth';
import { accountPage, signedIn, noticeCookie } from '../../_account';
import { discordPlatform, discordReply } from '../_discord';
import { showText } from '../../../join/_page';
import { setValue, formOf, field, type SignInPagesEnv } from '../../../sign-in/_shared';

async function confirmationPage(
  env: SignInPagesEnv,
  request: Request,
  message?: string,
  status = 200,
) {
  const platform = discordPlatform(env);
  const form = platform
    ? await new DiscordDisconnect(platform).form(
        readCookie(request, SESSION_COOKIE) ?? '',
        new URL(request.url).origin,
      )
    : null;
  if (!form) return discordReply(null, 303, { Location: '/account/#discord' });
  return await accountPage(env, request, '/account/discord/disconnect/', {
    status,
    fill: (rewriter) => {
      let filled = rewriter.on('input[name="token"]', setValue(form.token));
      if (form.disconnecting)
        filled = filled
          .on('[data-slot="discord-disconnect-label"]', showText(t('discord.tryAgain')))
          .on('[data-slot="discord-disconnect-back"]', showText(t('account.back')));
      const notice = message ?? (form.disconnecting ? t('discord.disconnecting') : undefined);
      return notice
        ? filled.on('[data-slot="discord-disconnect-error"]', showText(notice))
        : filled;
    },
  });
}

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  return signed instanceof Response ? signed : await confirmationPage(env, request);
};

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const origin = new URL(request.url).origin;
  if (request.headers.get('Origin') !== origin) return discordReply(t('discord.reload'), 403);
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const platform = discordPlatform(env);
  if (!platform) return await confirmationPage(env, request, t('discord.disconnectRetry'), 503);
  const result = await new DiscordDisconnect(platform).disconnect({
    sessionToken: readCookie(request, SESSION_COOKIE) ?? '',
    origin,
    csrfToken: field(await formOf(request), 'token'),
  });
  if (result.kind === 'disconnected')
    return discordReply(null, 303, {
      Location: '/account/#discord',
      'Set-Cookie': noticeCookie('discord_disconnected'),
    });
  return await confirmationPage(
    env,
    request,
    result.kind === 'retry' ? t('discord.disconnectRetry') : t('discord.confirmationExpired'),
    result.kind === 'retry' ? 503 : 409,
  );
};
