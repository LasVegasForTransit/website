import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  retryHeldWorkRequests,
  retryPreflightTagFailures,
  retryFailedWorkTagChecks,
  retryEligibilityRecovery,
} from '@lasvegasfortransit/platform-storage/discord-work-requests';
import {
  readWorkRoute,
  saveWorkRoute,
  activateWorkRoute,
  type WorkRoute,
} from '@lasvegasfortransit/platform-storage/discord-work-routes';
import {
  readWorkRouteBaseline,
  requestWorkRouteBaseline,
} from '@lasvegasfortransit/platform-storage/discord-work-route-scans';
import { resolveWorkActor } from './discord-work-authority';
import { previewWorkRoute, projectRouteSourceMatches } from './discord-work-route-preview';
import { showWorkRoute } from './discord-work-route-status';
import { notionObject } from './notion-task-types';
import { processWorkRouteRequest } from './discord-work-route-requests';
import { taskMarkdown } from './notion-task-cards';
import { setupReceipt, ownedReceipt, setupReply } from './discord-work-setup-common';
import { workMessage, workText, workButton, workCustomId } from './discord-work-cards';
import type { WorkProviders, WorkEffectContext } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';

async function freshPreview(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  { discordUserId, route }: { discordUserId: string; route: WorkRoute },
) {
  if (
    route.projectRelation &&
    !(await projectRouteSourceMatches(
      db,
      context.scope,
      context.taskSourceId,
      route.projectRelation.projectSourceId,
    ))
  )
    return null;
  const result = await previewWorkRoute(db, providers, {
    scope: context.scope,
    discordUserId: discordUserId,
    input: {
      sourceId: route.sourceId,
      kind: route.kind,
      trigger: route.trigger,
      ...(route.projectLeadField ? { projectLeadField: route.projectLeadField } : {}),
      destinationId: route.destination.channelId,
      ...(route.projectRelation ? { projectRelation: route.projectRelation } : {}),
      ...(route.tagSync ? { tagSync: route.tagSync } : {}),
    },
  });
  if (
    result.kind !== 'ready' ||
    result.audienceFingerprint !== route.audienceFingerprint ||
    result.destination.kind !== route.destination.kind ||
    (result.tagRequired && !route.tagIds?.length) ||
    (route.tagIds ?? []).some((id) => !result.availableTags.some((tag) => tag.id === id))
  )
    return null;
  return result;
}

async function retryRouteChecks(
  db: Db,
  context: WorkEffectContext,
  {
    actor,
    route,
  }: { actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>; route: WorkRoute },
): Promise<WorkPreviewResult> {
  if (!context.enabled || route.state !== 'active')
    return setupReply('Activate the route before retrying checks.');
  const queued = await retryHeldWorkRequests(
    db,
    actor,
    { scope: context.scope, routeId: route.id, revision: route.revision },
    context.clock(),
  );
  const retryPreflight = await retryPreflightTagFailures(
    db,
    actor,
    { scope: context.scope, routeId: route.id, revision: route.revision },
    context.clock(),
  );
  const retryEligibility = await retryEligibilityRecovery(
    db,
    actor,
    { scope: context.scope, routeId: route.id, revision: route.revision },
    context.clock(),
  );
  const retryTags = await retryFailedWorkTagChecks(
    db,
    actor,
    { scope: context.scope, routeId: route.id, revision: route.revision },
    context.clock(),
  );
  return setupReply(
    queued || retryPreflight || retryEligibility || retryTags
      ? 'Checks queued. The worker will recheck each page and its permissions.'
      : 'No eligible checks could be queued.',
  );
}

async function prepareRoute(
  db: Db,
  context: WorkEffectContext,
  {
    actor,
    route,
  }: { actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>; route: WorkRoute },
): Promise<WorkPreviewResult> {
  if (!context.enabled || route.state !== 'paused')
    return setupReply('This route cannot be prepared now.');
  const started = await requestWorkRouteBaseline(
    db,
    actor,
    { scope: context.scope, routeId: route.id, revision: route.revision },
    context.clock(),
  );
  return setupReply(
    started
      ? 'Preparing the route. Open /work routes again after the source scan finishes.'
      : 'Preparation could not start. Check access and try again.',
  );
}

async function pauseRoute(
  db: Db,
  context: WorkEffectContext,
  {
    actor,
    route,
  }: { actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>; route: WorkRoute },
): Promise<WorkPreviewResult> {
  if (route.state !== 'active') return setupReply('This route is already paused.');
  const saved = await saveWorkRoute(
    db,
    actor,
    {
      route: {
        ...route,
        state: 'paused',
        revision: route.revision + 1,
        approvedBy: actor.personId,
        approvedDiscordId: actor.discordUserId,
        approvedGrantVersion: actor.grantVersion,
      },
      expected: route.revision,
    },
    context.clock(),
  );
  return setupReply(
    saved
      ? 'Route paused. Existing Discord and Notion links remain.'
      : 'The route changed. Open /work routes again.',
  );
}

async function reviewRouteActivation(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    actor,
    route,
    input,
  }: {
    actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>;
    route: WorkRoute;
    input: WorkPreviewInput;
  },
): Promise<WorkPreviewResult> {
  if (
    !context.enabled ||
    route.state !== 'paused' ||
    !(await readWorkRouteBaseline(db, context.scope, route.id, route.revision))
  )
    return setupReply('Prepare this route before activation.');
  const preview = await freshPreview(db, providers, context, {
    discordUserId: input.discordUserId,
    route,
  });
  if (!preview)
    return setupReply('The source or destination changed. Edit the route and review it again.');
  const approval = await setupReceipt(
    db,
    {
      request: input,
      actor,
      payload: {
        intent: 'route-activation',
        routeId: route.id,
        revision: route.revision,
        preview,
      },
    },
    context,
  );
  return {
    kind: 'ready',
    card: workMessage([
      workText(
        `### Activate ${taskMarkdown(preview.sourceTitle)}\n${taskMarkdown(route.trigger.property)}: ${route.trigger.values.map(taskMarkdown).join(', ')}\nDestination: <#${route.destination.channelId}>\nExisting eligible events are checked for linked forum posts; uncertain matches need review. Existing projects are not automatically backfilled. New eligible pages and later status transitions can create Discord spaces. The destination audience may differ from Notion access.`,
      ),
      {
        type: 1,
        components: [
          workButton(
            workCustomId({ id: approval.id, generation: 1 }, 'route-enable-confirm'),
            'Activate route',
          ),
        ],
      },
    ]),
  };
}

async function confirmRouteActivation(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    actor,
    route,
    input,
    payload,
  }: {
    actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>;
    route: WorkRoute;
    input: WorkPreviewInput;
    payload: Record<string, unknown>;
  },
): Promise<WorkPreviewResult> {
  if (!context.enabled || route.state !== 'paused')
    return setupReply('This route cannot be activated now.');
  const preview = await freshPreview(db, providers, context, {
    discordUserId: input.discordUserId,
    route,
  });
  if (!preview || JSON.stringify(preview) !== JSON.stringify(payload.preview))
    return setupReply('The source or destination changed. Review activation again.');
  const activated = await activateWorkRoute(
    db,
    actor,
    {
      scope: context.scope,
      id: route.id,
      expected: route.revision,
      approval: {
        discordUserId: actor.discordUserId,
        grantVersion: actor.grantVersion,
        audienceFingerprint: preview.audienceFingerprint,
      },
    },
    context.clock(),
  );
  return setupReply(
    activated
      ? 'Route active. Newly eligible records can now create Discord spaces.'
      : 'Activation could not complete. Check the baseline and overlapping routes.',
  );
}

async function createReviewedEvent(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  { input, route }: { input: WorkPreviewInput; route: WorkRoute },
): Promise<WorkPreviewResult> {
  if (
    !context.enabled ||
    route.state !== 'active' ||
    !input.intent.value ||
    !(await providers.discord.membership(input.discordUserId, context.scope.guildId))
  )
    return setupReply('This event cannot be created now.');
  const result = await processWorkRouteRequest(db, providers, context, {
    routeId: route.id,
    revision: route.revision,
    id: input.intent.value,
  });
  return setupReply(
    result.kind === 'progress'
      ? 'The event is linked or its post is being created. Check its Notion page for the link.'
      : 'The event could not be created. Check its status, destination, and existing links.',
  );
}

async function dispatchRouteAction(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    actor,
    route,
    input,
    payload,
  }: {
    actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>;
    route: WorkRoute;
    input: WorkPreviewInput;
    payload: Record<string, unknown>;
  },
): Promise<WorkPreviewResult> {
  if (input.intent.action === 'route-create-event' && payload.intent === 'route-manage')
    return createReviewedEvent(db, providers, context, { input, route });
  if (input.intent.action === 'route-retry-checks' && payload.intent === 'route-manage')
    return retryRouteChecks(db, context, { actor, route });
  if (input.intent.action === 'route-prepare' && payload.intent === 'route-manage')
    return prepareRoute(db, context, { actor, route });
  if (input.intent.action === 'route-pause' && payload.intent === 'route-manage')
    return pauseRoute(db, context, { actor, route });
  if (input.intent.action === 'route-enable' && payload.intent === 'route-manage')
    return reviewRouteActivation(db, providers, context, { actor, route, input });
  if (input.intent.action === 'route-enable-confirm' && payload.intent === 'route-activation')
    return confirmRouteActivation(db, providers, context, { actor, route, input, payload });
  return setupReply('This route control is unavailable.');
}

/** All controls use actor-bound receipts; activation repeats provider checks before the atomic write. */
export async function manageWorkRoute(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const actor = await resolveWorkActor(db, context.scope, input.discordUserId);
  if (!actor?.administrator) return setupReply('Administrator access is required.');
  const receipt = await ownedReceipt(db, input, context);
  if (
    receipt?.state !== 'preview' ||
    receipt.actor_person_id !== actor.personId ||
    receipt.grant_version !== actor.grantVersion
  )
    return setupReply('This route control has expired. Open /work routes again.');
  const payload = notionObject(JSON.parse(receipt.payload_json) as unknown);
  if (input.intent.action === 'route-manage')
    return showWorkRoute(db, providers, context, { input, actor, payload });
  if (
    !['route-manage', 'route-activation'].includes(String(payload.intent)) ||
    typeof payload.routeId !== 'string' ||
    typeof payload.revision !== 'number'
  )
    return setupReply('This route control is unavailable.');
  const route = await readWorkRoute(db, context.scope, payload.routeId);
  if (route?.revision !== payload.revision)
    return setupReply('This route changed. Open /work routes again.');
  return dispatchRouteAction(db, providers, context, { actor, route, input, payload });
}
