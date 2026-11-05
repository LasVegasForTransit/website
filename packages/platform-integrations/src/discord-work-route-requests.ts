import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { readWorkRoute } from '@lasvegasfortransit/platform-storage/discord-work-routes';
import { findWorkSubject } from '@lasvegasfortransit/platform-storage/discord-work-links';
import { validateAdoptedThread } from './discord-work-adopt-destination';
import {
  nextWorkRouteRequest,
  readReviewedWorkRequest,
  queueWorkRouteRequest,
  holdWorkRouteRequest,
  deferWorkRouteRequest,
  reconcileWorkRouteRequest,
} from '@lasvegasfortransit/platform-storage/discord-work-requests';
import { authorizeWork } from './discord-work-authority';
import { projectRouteSourceMatches } from './discord-work-route-preview';
import { resolveEventProjectForum } from './discord-work-event-project';
import { notionObject } from './notion-task-types';
import { workFailure, type WorkProviders, type WorkEffectContext } from './discord-work-actions';
import type { WorkResult } from './discord-work-types';

const canonical = (id: string) => id.replaceAll('-', '').toLowerCase();

type RouteRequest = NonNullable<Awaited<ReturnType<typeof nextWorkRouteRequest>>>;
async function handleRouteRequestFailure(
  db: Db,
  context: WorkEffectContext,
  request: RouteRequest,
  error: unknown,
): Promise<WorkResult> {
  const known =
    error instanceof Error &&
    [
      'route_unavailable',
      'not_eligible',
      'authority_changed',
      'audience_or_permission_changed',
      'project_title_missing',
      'project_relation_unavailable',
      'project_choice_required',
      'project_forum_unavailable',
      'forum_tag_required',
      'existing_event_review',
      'existing_event_unavailable',
    ].includes(error.message)
      ? error.message
      : null;
  const failure = workFailure(error);
  const reason = known ?? failure.reason ?? 'unconfirmed_effect';
  if (!known && failure.state === 'retryable')
    await deferWorkRouteRequest(
      db,
      {
        scope: context.scope,
        request: request,
        retry: { reason: reason, retryAfterMs: failure.retryAfterMs ?? 60_000 },
      },
      context.clock(),
    );
  else await holdWorkRouteRequest(db, context.scope, request, reason);
  return { kind: 'paused', reason };
}

function validateEligiblePage(
  page: Record<string, unknown>,
  route: NonNullable<Awaited<ReturnType<typeof readWorkRoute>>>,
  request: RouteRequest,
) {
  const parent = notionObject(page.parent),
    field = notionObject(notionObject(page.properties)[route.trigger.property]);
  if (
    page.object !== 'page' ||
    typeof page.id !== 'string' ||
    canonical(page.id) !== request.page_id ||
    typeof parent.data_source_id !== 'string' ||
    canonical(parent.data_source_id) !== request.source_id ||
    page.archived === true ||
    page.in_trash === true ||
    (field.type !== 'status' && field.type !== 'select') ||
    !route.trigger.values.some((value) => notionObject(field[field.type as string]).name === value)
  )
    throw new Error('not_eligible');
}

async function loadEligibleRoute(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  request: RouteRequest,
) {
  const route = await readWorkRoute(db, context.scope, request.route_id);
  if (
    route?.state !== 'active' ||
    route.revision !== request.route_revision ||
    !route.approvedDiscordId ||
    !route.approvedGrantVersion ||
    (route.kind === 'project' && route.destination.kind !== 'category') ||
    (route.kind === 'event' && route.destination.kind === 'category' && !route.projectRelation)
  )
    throw new Error('route_unavailable');
  const page = notionObject(await providers.notion.readPage(request.page_id));
  validateEligiblePage(page, route, request);
  return { route, page, discordUserId: route.approvedDiscordId };
}

function requestTagsUnavailable(
  route: NonNullable<Awaited<ReturnType<typeof readWorkRoute>>>,
  destination: Awaited<ReturnType<WorkProviders['discord']['inspectDestination']>>,
): boolean {
  return (
    (destination.requiredTag && !route.tagIds?.length) ||
    (route.tagIds ?? []).some((id) => !destination.tags.some((tag) => tag.id === id))
  );
}

function validateRequestDestination(
  route: NonNullable<Awaited<ReturnType<typeof readWorkRoute>>>,
  destination: Awaited<ReturnType<WorkProviders['discord']['inspectDestination']>>,
  adopting: boolean,
) {
  if (
    !destination.canRead ||
    destination.audienceFingerprint !== route.audienceFingerprint ||
    (route.kind === 'project' && (!destination.isCategory || !destination.canManageChannels)) ||
    (route.kind === 'event' &&
      !route.projectRelation &&
      (destination.isCategory ||
        destination.destination.kind !== route.destination.kind ||
        !destination.canSend ||
        (destination.destination.kind === 'text' && !destination.canCreateThreads) ||
        (!adopting && requestTagsUnavailable(route, destination))))
  )
    throw new Error('audience_or_permission_changed');
}

async function resolveRequestDestination(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    route,
    page,
    adopting,
  }: {
    adopting: boolean;
    route: NonNullable<Awaited<ReturnType<typeof readWorkRoute>>>;
    page: Record<string, unknown>;
  },
) {
  const destination = await providers.discord.inspectDestination(route.destination.channelId);
  validateRequestDestination(route, destination, adopting);
  let destinationId = route.destination.channelId;
  let projectId: string | undefined;
  let eventTagIds = route.tagIds ?? [];
  if (route.kind === 'event' && route.projectRelation) {
    if (!destination.isCategory) throw new Error('audience_or_permission_changed');
    if (
      !(await projectRouteSourceMatches(
        db,
        context.scope,
        context.taskSourceId,
        route.projectRelation.projectSourceId,
      ))
    )
      throw new Error('project_relation_unavailable');
    const resolved = await resolveEventProjectForum(db, providers, context.scope, {
      page,
      relation: route.projectRelation.property,
      projectSourceId: route.projectRelation.projectSourceId,
      categoryId: route.destination.channelId,
      audienceFingerprint: route.audienceFingerprint,
      ignoreTags: adopting,
    });
    if (resolved.kind !== 'ready') throw new Error(resolved.reason);
    eventTagIds = resolved.tagIds;
    destinationId = resolved.forumId;
    projectId = resolved.projectId;
  }
  return { destinationId, projectId, eventTagIds };
}

function projectTitle(properties: unknown): string {
  const titleProperty = Object.values(notionObject(properties))
    .map(notionObject)
    .find((property) => property.type === 'title');
  const title = Array.isArray(titleProperty?.title)
    ? titleProperty.title
        .map((part) => {
          const text = notionObject(part).plain_text;
          return typeof text === 'string' ? text : '';
        })
        .join('')
        .trim()
        .slice(0, 100)
    : '';
  return title;
}

async function completeLinkedEvent(db: Db, request: RouteRequest): Promise<WorkResult> {
  const result = await db
    .prepare(
      "UPDATE discord_work_requests SET state='completed',reason=NULL WHERE id=? AND (state='pending' OR (state='held' AND reason='existing_event_review' AND operation_id IS NULL)) AND route_revision=?",
    )
    .bind(request.id, request.route_revision)
    .run();
  return result.meta.changes ? { kind: 'progress' } : { kind: 'idle' };
}

async function existingEventMatch(
  providers: WorkProviders,
  input: { destinationId: string; pageId: string; audience: string },
): Promise<string> {
  const destination = await providers.discord.inspectDestination(input.destinationId);
  if (destination.destination.kind !== 'forum') throw new Error('existing_event_review');
  const match = await providers.discord.findLinkedEvent(input.destinationId, input.pageId);
  if (!match) throw new Error('existing_event_review');
  const thread = await providers.discord.inspectDestination(match);
  if (
    !validateAdoptedThread({
      thread,
      expectedParentId: input.destinationId,
      approvedAudience: input.audience,
    })
  )
    throw new Error('existing_event_unavailable');
  return match;
}

function routeSubject(
  route: NonNullable<Awaited<ReturnType<typeof readWorkRoute>>>,
  request: RouteRequest,
) {
  return {
    kind: route.kind === 'event' ? ('event_plan' as const) : ('project_plan' as const),
    sourceId: request.source_id,
    pageId: request.page_id,
  };
}

function existingEvent(
  route: NonNullable<Awaited<ReturnType<typeof readWorkRoute>>>,
  request: RouteRequest,
): boolean {
  return route.kind === 'event' && request.existing_event === 1;
}

function optionalPlacement(adoptThreadId: string | undefined, projectId: string | undefined) {
  return { ...(adoptThreadId ? { adoptThreadId } : {}), ...(projectId ? { projectId } : {}) };
}

async function selectRouteRequest(
  db: Db,
  context: WorkEffectContext,
  reviewed?: { routeId: string; revision: number; id: string },
) {
  if (reviewed) return readReviewedWorkRequest(db, context.scope, reviewed);
  if (await reconcileWorkRouteRequest(db, context.scope)) return 'reconciled' as const;
  return nextWorkRouteRequest(db, context.scope, context.clock());
}

/** Re-fetch eligibility and authority before moving one request to the durable provision queue. */
export async function processWorkRouteRequest(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  reviewed?: { routeId: string; revision: number; id: string },
): Promise<WorkResult> {
  if (!context.enabled) return { kind: 'idle' };
  const request = await selectRouteRequest(db, context, reviewed);
  if (request === 'reconciled') return { kind: 'progress' };
  if (!request) return { kind: 'idle' };
  try {
    const { route, page, discordUserId } = await loadEligibleRoute(db, providers, context, request);
    const subject = routeSubject(route, request);
    const actor = await authorizeWork(
      db,
      providers,
      {
        scope: context.scope,
        subject,
        discordUserId,
        action: 'manage_home',
        taskSourceId: context.taskSourceId,
      },
      context.clock(),
    );
    if (actor?.personId !== route.approvedBy || actor.grantVersion !== route.approvedGrantVersion)
      throw new Error('authority_changed');
    const existing = existingEvent(route, request);
    const adopting = existing && !reviewed;
    if (existing && (await findWorkSubject(db, context.scope, subject)))
      return await completeLinkedEvent(db, request);
    const { destinationId, projectId, eventTagIds } = await resolveRequestDestination(
      db,
      providers,
      context,
      { route, page, adopting },
    );
    const title = projectTitle(page.properties);
    if (!title) throw new Error('project_title_missing');
    const adoptThreadId = adopting
      ? await existingEventMatch(providers, {
          destinationId,
          pageId: request.page_id,
          audience: route.audienceFingerprint,
        })
      : undefined;
    const queued = await queueWorkRouteRequest(
      db,
      {
        scope: context.scope,
        request: request,
        reviewed: Boolean(reviewed),
        effect: {
          actor: actor,
          payload: {
            intent: route.kind === 'event' ? 'event' : 'home',
            linkId: `route-home-${request.id}`,
            subject,
            title,
            destinationId,
            audienceFingerprint: route.audienceFingerprint,
            createForum: route.kind === 'project',
            tagIds: eventTagIds,
            ...optionalPlacement(adoptThreadId, projectId),
            routeId: route.id,
            routeRevision: route.revision,
          },
        },
      },
      context.clock(),
    );
    if (queued) return { kind: 'progress' };
    await holdWorkRouteRequest(db, context.scope, request, 'route_changed_or_conflict');
    return { kind: 'paused', reason: 'route_changed_or_conflict' };
  } catch (error) {
    return handleRouteRequestFailure(db, context, request, error);
  }
}
