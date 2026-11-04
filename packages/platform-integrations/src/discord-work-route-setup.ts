import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { resolveWorkActor } from './discord-work-authority';
import { discoverWorkSources } from './discord-work-source-discovery';
import { confirmWorkRouteApproval } from './discord-work-route-preview';
import { notionObject } from './notion-task-types';
import { listRouteControls } from './discord-work-route-list';
import { sourcePicker, selectRouteSource } from './discord-work-route-source-picker';
import { editRoute, selectRouteDestination } from './discord-work-route-edit';
import { reviewRouteSetup } from './discord-work-route-review';
import { setupReceipt, ownedReceipt, setupReply } from './discord-work-setup-common';
import type { WorkEffectContext, WorkProviders } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';

async function startRouteSetup(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    input,
    actor,
  }: { input: WorkPreviewInput; actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>> },
): Promise<WorkPreviewResult> {
  const page = await discoverWorkSources(db, providers, {
    scope: context.scope,
    discordUserId: input.discordUserId,
    input: {
      query: '',
      cursor: null,
    },
  });
  if (page.kind !== 'ready')
    return setupReply('Notion sources are unavailable. Check the connection and try again.');
  const payload = {
    intent: 'route-setup',
    kind: input.intent.action === 'route-project' ? 'project' : 'event',
    projectMode: input.intent.action === 'route-event-project',
    destinationId: input.intent.destinationId ?? input.channelId,
    sources: page.sources,
    nextCursor: page.nextCursor,
  };
  const receipt = await setupReceipt(db, { request: input, actor, payload }, context);
  return sourcePicker(receipt.id, payload);
}

function validSetupReceipt(
  receipt: Awaited<ReturnType<typeof ownedReceipt>>,
  actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>,
): receipt is NonNullable<Awaited<ReturnType<typeof ownedReceipt>>> {
  return (
    receipt?.state === 'preview' &&
    receipt.actor_person_id === actor.personId &&
    receipt.grant_version === actor.grantVersion
  );
}

export async function routeSetup(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const actor = await resolveWorkActor(db, context.scope, input.discordUserId);
  if (!actor?.administrator) return setupReply('Administrator access is required.');
  if (input.intent.action === 'routes' || input.intent.action === 'routes-more')
    return listRouteControls(db, context, input, actor);
  if (input.intent.action === 'route-approve') {
    if (!context.enabled) return setupReply('Shared work is disabled.');
    const result = await confirmWorkRouteApproval(db, providers, {
      scope: context.scope,
      discordUserId: input.discordUserId,
      receiptId: input.intent.linkId ?? '',
      now: context.clock(),
    });
    return setupReply(
      result.kind === 'saved'
        ? 'Route saved and paused. Open /work routes to prepare and activate it.'
        : 'The route could not be saved. Check the source, permissions, and preview, then try again.',
    );
  }
  if (['route-event', 'route-project', 'route-event-project'].includes(input.intent.action))
    return startRouteSetup(db, providers, context, { input, actor });
  const receipt = await ownedReceipt(db, input, context);
  if (!validSetupReceipt(receipt, actor)) return setupReply('This setup has expired. Start again.');
  const p = notionObject(JSON.parse(receipt.payload_json) as unknown);
  if (input.intent.action === 'route-edit') return editRoute(db, context, { input, receipt, p });
  if (input.intent.action === 'route-dest')
    return selectRouteDestination(db, providers, context, { input, receipt, p });
  if (p.intent !== 'route-setup') return setupReply('This setup is unavailable. Start again.');
  const sourceSelection = await selectRouteSource(db, providers, context, { input, receipt, p });
  if (sourceSelection) return sourceSelection;
  return reviewRouteSetup(db, providers, context, { input, receipt, p });
}
