/// <reference types="@cloudflare/workers-types" />
import type { DiscordLinkProfile } from '@lasvegasfortransit/platform-storage/discord-link';
import { show, showText } from '../functions/join/_page';
export function fillDiscordProfile(
  rewriter: HTMLRewriter,
  profile: DiscordLinkProfile | null,
): HTMLRewriter {
  if (!profile) return rewriter;
  const shown = rewriter.on('[data-slot="discord"]', show());
  if (!profile.linked) return shown;
  return shown
    .on(
      '[data-slot="discord-status"]',
      showText(
        profile.username
          ? `Connected as ${profile.username}.`
          : 'Your Discord account is connected.',
      ),
    )
    .on('[data-slot="discord"] a', showText('Confirm connection'));
}
