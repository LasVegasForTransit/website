import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { readWorkRoute } from '@lasvegasfortransit/platform-storage/discord-work-routes';
import { discordId } from './discord-types';
import { discoverWorkSources } from './discord-work-source-discovery';
import { sourcePicker } from './discord-work-route-source-picker';
import { savePayload } from './discord-work-route-setup-common';
import { setupReply } from './discord-work-setup-common';
import type { ownedReceipt } from './discord-work-setup-common';
import { workMessage, workText, workCustomId } from './discord-work-cards';
import type { WorkEffectContext, WorkProviders } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';

export async function editRoute(
  db: Db,
  context: WorkEffectContext,
  {
    input,
    receipt,
    p,
  }: {
    input: WorkPreviewInput;
    receipt: NonNullable<Awaited<ReturnType<typeof ownedReceipt>>>;
    p: Record<string, unknown>;
  },
): Promise<WorkPreviewResult> {
  if (
    p.intent !== 'route-list' ||
    !Array.isArray(p.routeIds) ||
    !p.routeIds.includes(input.intent.value)
  )
    return setupReply('Choose a route from the list.');
  const route = await readWorkRoute(db, context.scope, String(input.intent.value));
  if (!route) return setupReply('This route is unavailable.');
  const next = {
    intent: 'route-edit',
    routeId: route.id,
    revision: route.revision,
    kind: route.kind,
    projectMode: Boolean(route.projectRelation),
  };
  if (
    !(await savePayload(db, receipt.id, input.discordUserId, {
      original: receipt.payload_json,
      payload: next,
    }))
  )
    return setupReply('This setup changed. Start again.');
  return {
    kind: 'ready',
    card: workMessage([
      workText('Choose a destination for this route. Existing links will remain intact.'),
      {
        type: 1,
        components: [
          {
            type: 8,
            custom_id: workCustomId({ id: receipt.id, generation: 1 }, 'route-dest'),
            placeholder: 'Choose a destination',
            channel_types: route.kind === 'project' || route.projectRelation ? [4] : [0, 15],
          },
        ],
      },
    ]),
  };
}

export async function selectRouteDestination(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    input,
    receipt,
    p,
  }: {
    input: WorkPreviewInput;
    receipt: NonNullable<Awaited<ReturnType<typeof ownedReceipt>>>;
    p: Record<string, unknown>;
  },
): Promise<WorkPreviewResult> {
  if (
    p.intent !== 'route-edit' ||
    typeof p.routeId !== 'string' ||
    typeof p.revision !== 'number' ||
    !['project', 'event'].includes(String(p.kind)) ||
    !discordId(input.intent.value)
  )
    return setupReply('Choose a destination from the list.');
  const page = await discoverWorkSources(db, providers, {
    scope: context.scope,
    discordUserId: input.discordUserId,
    input: {
      query: '',
      cursor: null,
    },
  });
  if (page.kind !== 'ready') return setupReply('Notion sources are unavailable.');
  const next = {
    intent: 'route-setup',
    kind: p.kind,
    projectMode: p.projectMode === true,
    routeId: p.routeId,
    revision: p.revision,
    destinationId: input.intent.value,
    sources: page.sources,
    nextCursor: page.nextCursor,
  };
  return (await savePayload(db, receipt.id, input.discordUserId, {
    original: receipt.payload_json,
    payload: next,
  }))
    ? sourcePicker(receipt.id, next)
    : setupReply('This setup changed. Start again.');
}
