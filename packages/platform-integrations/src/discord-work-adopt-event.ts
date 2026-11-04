import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { workScopeKey } from '@lasvegasfortransit/platform-storage/discord-work-types';
import {
  readWorkRoute,
  type WorkRoute,
} from '@lasvegasfortransit/platform-storage/discord-work-routes';
import { findWorkSubject } from '@lasvegasfortransit/platform-storage/discord-work-links';
import { authorizeWork, readWorkSource } from './discord-work-authority';
import { notionWorkId, notionWorkUrl } from './discord-work-input';
import { notionObject } from './notion-task-types';
import { resolveEventProjectForum } from './discord-work-event-project';
import { validateAdoptedThread } from './discord-work-adopt-destination';
import { setupReceipt, receiptCard, setupReply } from './discord-work-setup-common';
import type { WorkProviders, WorkEffectContext } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';

async function eventSource(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
) {
  const pageId = notionWorkUrl(input.intent.url);
  if (!pageId) return { error: setupReply('Provide the Notion event page URL.') } as const;
  const page = notionObject(await providers.notion.readPage(pageId));
  const sourceId = notionWorkId(notionObject(page.parent).data_source_id);
  if (
    page.object !== 'page' ||
    notionWorkId(page.id) !== pageId ||
    !sourceId ||
    page.archived === true ||
    page.in_trash === true
  )
    return { error: setupReply('The event page is unavailable.') } as const;
  const row = await db
    .prepare(
      "SELECT id FROM discord_work_routes WHERE scope_key=? AND state='active' AND lower(replace(source_id,'-',''))=? LIMIT 2",
    )
    .bind(workScopeKey(context.scope), sourceId.replaceAll('-', ''))
    .all<{ id: string }>();
  const match = row.results[0];
  if (row.results.length !== 1 || !match)
    return { error: setupReply('The event source needs one active route.') } as const;
  const route = await readWorkRoute(db, context.scope, match.id);
  if (route?.kind !== 'event')
    return { error: setupReply('The event source needs an active event route.') } as const;
  const field = notionObject(notionObject(page.properties)[route.trigger.property]);
  if (
    (field.type !== 'select' && field.type !== 'status') ||
    !route.trigger.values.some((value) => value === notionObject(field[field.type as string]).name)
  )
    return { error: setupReply('The event does not match the route status.') } as const;
  return { pageId, sourceId, page, route } as const;
}

async function eventDestination(
  db: Db,
  providers: WorkProviders,
  input: { route: WorkRoute; page: Record<string, unknown> },
  context: WorkEffectContext,
) {
  const { route, page } = input;
  let parentId = route.destination.channelId;
  let projectId: string | undefined;
  if (route.projectRelation) {
    const source = await readWorkSource(db, context.taskSourceId, context.scope);
    if (
      !source ||
      notionWorkId(source.policy.projectsSourceId) !==
        notionWorkId(route.projectRelation.projectSourceId)
    )
      return { error: setupReply('The project source is unavailable.') } as const;
    const resolved = await resolveEventProjectForum(db, providers, context.scope, {
      page,
      relation: route.projectRelation.property,
      projectSourceId: route.projectRelation.projectSourceId,
      categoryId: route.destination.channelId,
      audienceFingerprint: route.audienceFingerprint,
      ignoreTags: true,
    });
    if (resolved.kind !== 'ready')
      return {
        error: setupReply('The project forum is unavailable or its audience changed.'),
      } as const;
    parentId = resolved.forumId;
    projectId = resolved.projectId;
  }
  return { parentId, projectId } as const;
}

function eventTitle(page: Record<string, unknown>): string {
  const property = Object.values(notionObject(page.properties))
    .map(notionObject)
    .find((p) => p.type === 'title');
  const title = Array.isArray(property?.title)
    ? property.title
        .map((p) => {
          const value = notionObject(p).plain_text;
          return typeof value === 'string' ? value : '';
        })
        .join('')
        .trim()
        .slice(0, 100)
    : '';
  return title;
}

/** Preview adoption from inside the existing event thread; confirmation queues a durable effect. */
export async function adoptEvent(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  if (!context.enabled) return setupReply('Project linking is disabled.');
  const source = await eventSource(db, providers, input, context);
  if ('error' in source) return source.error;
  const { pageId, sourceId, page, route } = source;
  const subject = { kind: 'event_plan' as const, sourceId, pageId };
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject,
      discordUserId: input.discordUserId,
      action: 'manage_home',
      taskSourceId: context.taskSourceId,
    },
    context.clock(),
  );
  if (!actor) return setupReply('Administrator access is required.');
  const existing = await findWorkSubject(db, context.scope, subject);
  if (existing)
    return setupReply(
      `This event already has a conversation: https://discord.com/channels/${context.scope.guildId}/${existing.threadId}`,
    );
  const destination = await eventDestination(db, providers, { route, page }, context);
  if ('error' in destination) return destination.error;
  const { parentId, projectId } = destination;
  const thread = await providers.discord.inspectDestination(input.channelId);
  if (thread.privateThread === true)
    return setupReply(
      'Private threads cannot be adopted because their audience may differ from the parent channel.',
    );
  if (
    !validateAdoptedThread({
      thread,
      expectedParentId: parentId,
      approvedAudience: route.audienceFingerprint,
    })
  )
    return setupReply('Run this in an accessible thread within the approved destination.');
  const title = eventTitle(page);
  if (!title) return setupReply('The event needs a title.');
  const receipt = await setupReceipt(
    db,
    {
      request: input,
      actor,
      payload: {
        intent: 'event',
        linkId: crypto.randomUUID(),
        subject,
        title,
        destinationId: parentId,
        adoptThreadId: input.channelId,
        audienceFingerprint: route.audienceFingerprint,
        routeId: route.id,
        routeRevision: route.revision,
        tagIds: [],
        ...(projectId ? { projectId } : {}),
        description:
          'Connect this existing thread to the event. The bot will add a link to Notion, and the Notion page will link here.',
      },
    },
    context,
  );
  return receiptCard(receipt, context);
}
