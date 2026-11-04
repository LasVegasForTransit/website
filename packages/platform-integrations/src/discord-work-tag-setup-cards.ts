import type { WorkRoute } from '@lasvegasfortransit/platform-storage/discord-work-routes';
import { workMessage, workText, workCustomId } from './discord-work-cards';
import type { WorkProviders } from './discord-work-actions';
import type { WorkPreviewResult } from './discord-work-interactions';

export async function forumForRoute(providers: WorkProviders, route: WorkRoute, forumId: string) {
  const forum = await providers.discord.inspectDestination(forumId);
  if (
    forum.destination.kind !== 'forum' ||
    !forum.canRead ||
    !forum.canSend ||
    forum.archived ||
    forum.locked ||
    forum.audienceFingerprint !== route.audienceFingerprint ||
    (route.destination.kind === 'forum'
      ? forumId !== route.destination.channelId
      : route.destination.kind !== 'category' ||
        forum.destination.parentId !== route.destination.channelId)
  )
    return null;
  if (
    !forum.tags.length ||
    forum.tags.length > 25 ||
    new Set(forum.tags.map((tag) => tag.name)).size !== forum.tags.length
  )
    return null;
  return forum;
}
export function selectCard(
  id: string,
  action: string,
  heading: string,
  options: { label: string; value: string }[],
): WorkPreviewResult {
  return {
    kind: 'ready',
    card: workMessage([
      workText(heading),
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: workCustomId({ id, generation: 1 }, action),
            placeholder: 'Choose one',
            options,
          },
        ],
      },
    ]),
  };
}
