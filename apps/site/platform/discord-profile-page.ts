import { t } from '@lasvegasfortransit/platform-core/messages';
/// <reference types="@cloudflare/workers-types" />
import type { DiscordLinkProfile } from '@lasvegasfortransit/platform-storage/discord-link';
import { show, showText } from '../functions/join/_page';
export function fillDiscordProfile(
  rewriter: HTMLRewriter,
  profile: DiscordLinkProfile | null,
): HTMLRewriter {
  if (!profile) return rewriter;
  const shown = rewriter
    .on('[data-slot="discord"]', show())
    .on('[data-slot="discord-nav"]', show());
  if (!profile.linked) return shown;
  return shown
    .on(
      '[data-slot="discord-status"]',
      showText(
        profile.disconnecting
          ? t('discord.disconnecting')
          : profile.username
            ? t('discord.connectedAs', { name: profile.username })
            : t('discord.connected'),
      ),
    )
    .on('[data-slot="discord-manage"]', showText(t('discord.manage')))
    .on('[data-slot="discord-disconnect"]', show());
}
