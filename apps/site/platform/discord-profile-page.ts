import { t } from '@lasvegasfortransit/platform-core/messages';
/// <reference types="@cloudflare/workers-types" />
import type { DiscordLinkProfile } from '@lasvegasfortransit/platform-storage/discord-link';
import { show, showText } from '../functions/join/_page';
export function fillDiscordProfile(
  rewriter: HTMLRewriter,
  profile: DiscordLinkProfile | null,
  regionVisible: boolean | null = null,
): HTMLRewriter {
  if (!profile) return rewriter;
  let shown = rewriter.on('[data-slot="discord"]', show()).on('[data-slot="discord-nav"]', show());
  if (regionVisible !== null)
    shown = shown.on('[data-slot="discord-region-sharing"]', show()).on('input[name="visible"]', {
      element(element) {
        if (regionVisible) element.setAttribute('checked', '');
        else element.removeAttribute('checked');
      },
    });
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
    .on('[data-slot="discord-manage"]', {
      element(element) {
        element.remove();
      },
    })
    .on('[data-slot="discord-access"]', profile.disconnecting ? {} : show())
    .on('[data-slot="discord-disconnect"]', show());
}
