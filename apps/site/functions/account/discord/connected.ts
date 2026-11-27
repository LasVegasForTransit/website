/// <reference types="@cloudflare/workers-types" />

// /account/discord/connected: what a member sees right after connecting
// Discord. It reads the verified account and the roles LVBT keeps in sync,
// then hands off to Discord, whose server onboarding covers the rest.

import { t } from '@lasvegasfortransit/platform-core/messages';
import { escapeHtml } from '@lasvegasfortransit/platform-integrations/email';
import { isDiscordId as discordId } from '@lasvegasfortransit/platform-core/discord-identity';
import {
  DiscordLinkService,
  type DiscordConnectionSummary,
} from '@lasvegasfortransit/platform-storage/discord-link';
import { readCookie } from '@lasvegasfortransit/platform-core/web-auth';
import {
  requestDiscordChannels,
  type DiscordChannelLink,
} from '@lasvegasfortransit/platform-integrations/discord-channels';
import { linkClass } from '../../../src/components/app/styles';
import { accountPage } from '../_account';
import { show, showText } from '../../join/_page';
import type { SignInPagesEnv } from '../../sign-in/_shared';
import {
  DISCORD_NEXT_COOKIE,
  discordMember,
  discordNextCookie,
  discordReply,
  discordReturnPath,
} from './_discord';

/** One list item per synced committee, in the order the summary gives them. */
export function committeeItems(connection: DiscordConnectionSummary): string {
  return connection.committees
    .map(
      (committee) =>
        `<li class="py-2">${escapeHtml(
          committee.lead
            ? t('discord.accessLead', { name: committee.name })
            : t('discord.accessCommittee', { name: committee.name }),
        )}</li>`,
    )
    .join('');
}

/** Each channel the member's roles open, linked by name. */
export function channelItems(guildId: string, channels: DiscordChannelLink[]): string {
  return channels
    .map(
      (channel) =>
        `<li><a href="https://discord.com/channels/${guildId}/${channel.id}" class="inline-flex min-h-11 items-center ${linkClass}">#${escapeHtml(channel.name)}</a></li>`,
    )
    .join('');
}

export function discordServerUrl(guildId: string | undefined): string | null {
  return discordId(guildId) ? `https://discord.com/channels/${guildId}` : null;
}

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await discordMember(env, request);
  // The connect page explains why connecting is unavailable, as a full page.
  if (signed instanceof Response)
    return signed.status < 400
      ? signed
      : discordReply(null, 303, { Location: '/account/discord/' });
  const connection = await new DiscordLinkService(signed.platform).connection(signed.sessionToken);
  if (!connection) return discordReply(null, 303, { Location: '/account/discord/' });
  const returnTo = discordReturnPath(
    decodeURIComponent(readCookie(request, DISCORD_NEXT_COOKIE) ?? ''),
  );
  const server = discordServerUrl(env.LVBT_DISCORD_GUILD_ID);
  const guildId = server ? env.LVBT_DISCORD_GUILD_ID : undefined;
  // Live channel names come from the jobs Worker; without them the page lists roles by name.
  const channels =
    guildId && env.LVBT_DISCORD_JOBS
      ? await requestDiscordChannels(env.LVBT_DISCORD_JOBS, {
          member: connection.memberRole,
          roleIds: connection.roleIds,
        })
      : null;
  const name = connection.displayName ?? connection.username;
  const response = await accountPage(env, request, '/account/discord/connected/', {
    fill: (rewriter) => {
      let filled = rewriter
        .on('[data-slot="discord-initial"]', showText(Array.from(name)[0]?.toUpperCase() ?? 'D'))
        .on('[data-slot="discord-display-name"]', showText(name))
        .on('[data-slot="discord-username"]', showText(`@${connection.username}`));
      if (channels?.length && guildId)
        filled = filled.on('[data-slot="discord-access"]', {
          element(element) {
            element.setInnerContent(channelItems(guildId, channels), { html: true });
          },
        });
      else {
        if (connection.memberRole)
          filled = filled.on('[data-slot="discord-access-member"]', show());
        if (connection.committees.length)
          filled = filled.on('[data-slot="discord-access-committees"]', {
            element(element) {
              element.replace(committeeItems(connection), { html: true });
            },
          });
      }
      if (!connection.committees.length)
        filled = filled.on('[data-slot="discord-access-none"]', show());
      if (server)
        filled = filled.on('[data-slot="discord-open"]', {
          element(element) {
            element.setAttribute('href', server);
          },
        });
      if (returnTo)
        filled = filled
          .on('[data-slot="discord-return-link"]', {
            element(element) {
              element.setAttribute('href', returnTo);
            },
          })
          .on('[data-slot="discord-return-link"]', showText(t('discord.startReturn')));
      return filled;
    },
  });
  if (returnTo) response.headers.append('Set-Cookie', discordNextCookie(''));
  return response;
};
