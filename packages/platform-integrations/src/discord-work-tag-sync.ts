import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readProjectHome,
  readWorkConversation,
  commitManagedForumTags,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  findActiveWorkRoute,
  readWorkRoute,
} from '@lasvegasfortransit/platform-storage/discord-work-routes';
import {
  enqueueWorkOperation,
  settleWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { authorizeWork } from './discord-work-authority';
import {
  currentWorkAudience,
  workFailure,
  type WorkProviders,
  type WorkEffectContext,
} from './discord-work-actions';
import { sameNotionWorkId } from './discord-work-input';
import { DiscordApiFailure } from './discord-types';
import { notionObject } from './notion-task-types';
import { planManagedForumTags, resolveMappedForumTag } from './discord-work-tag-reconciliation';
import type { WorkConversation, WorkOperation, WorkResult } from './discord-work-types';

/** Each Notion edit and approved route revision has at most one durable tag operation. */
export async function queueWorkTagSync(
  db: Db,
  conversation: WorkConversation,
  editedAt: unknown,
  context: WorkEffectContext,
): Promise<boolean> {
  if (
    !context.enabled ||
    conversation.state !== 'active' ||
    !['project_plan', 'event_plan'].includes(conversation.subject.kind) ||
    typeof editedAt !== 'string' ||
    !Number.isFinite(Date.parse(editedAt))
  )
    return false;
  const route = await findActiveWorkRoute(db, context.scope, conversation.subject.sourceId);
  if (
    !route?.tagSync ||
    !route.approvedBy ||
    !route.approvedDiscordId ||
    !route.approvedGrantVersion
  )
    return false;
  const result = await enqueueWorkOperation(
    db,
    {
      id: crypto.randomUUID(),
      scope: context.scope,
      homeId: conversation.homeId,
      conversationId: conversation.id,
      generation: conversation.generation,
      kind: 'refresh',
      sourceKey: `tag-sync:${conversation.id}:${conversation.generation}:${route.id}:${route.revision}:${editedAt}`,
      actorPersonId: route.approvedBy,
      actorDiscordId: route.approvedDiscordId,
      grantVersion: route.approvedGrantVersion,
      originalAuthorId: route.approvedDiscordId,
      payload: { intent: 'tag-sync', routeId: route.id, routeRevision: route.revision },
    },
    context.clock(),
  );
  return result === 'queued';
}

async function handleTagSyncFailure(
  db: Db,
  op: WorkOperation,
  context: WorkEffectContext,
  error: unknown,
): Promise<WorkResult> {
  if (error instanceof DiscordApiFailure && error.kind === 'rate_limited' && !op.result_json) {
    const now = context.clock();
    const retryAt = new Date(now.getTime() + Math.max(1000, error.retryAfterMs ?? 60_000));
    const settled = await db
      .prepare(
        "UPDATE discord_work_operations SET state='retryable',reason='rate_limited',result_json=NULL,next_attempt_at=?,claim_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND scope_key=? AND state='processing' AND claim_token=? AND lease_expires_at>?",
      )
      .bind(
        retryAt.toISOString(),
        now.toISOString(),
        op.id,
        op.scope_key,
        op.claim_token,
        now.toISOString(),
      )
      .run();
    return {
      kind: 'paused',
      reason: settled.meta.changes ? 'rate_limited' : 'unconfirmed_effect',
    };
  }
  const outcome =
    error instanceof Error &&
    ((error.message === 'tag_mapping_unavailable' && !op.result_json) ||
      error.message === 'forum_tags_changed')
      ? { state: 'failed' as const, reason: error.message }
      : workFailure(error);
  await settleWorkOperation(db, { id: op.id, token: op.claim_token }, outcome, context.clock());
  return { kind: 'paused', reason: outcome.reason };
}

function recoverTagCheckpoint(
  saved: Record<string, unknown>,
  current: string[],
  desiredTag: string,
  { previous, routeId }: { previous: WorkConversation['managedForumTags'] | null; routeId: string },
) {
  if (
    !Array.isArray(saved.expected) ||
    !Array.isArray(saved.target) ||
    !Array.isArray(saved.owned) ||
    !saved.expected.every((v) => typeof v === 'string') ||
    !saved.target.every((v) => typeof v === 'string') ||
    !saved.owned.every((v) => typeof v === 'string') ||
    !saved.target.includes(desiredTag)
  )
    throw new Error('unconfirmed_effect');
  const expected = saved.expected,
    target = saved.target,
    owned = saved.owned;
  const ownershipRecorded = JSON.stringify(previous) === JSON.stringify({ routeId, tagIds: owned });
  if (!ownershipRecorded && JSON.stringify(saved.previous ?? null) !== JSON.stringify(previous))
    throw new Error('unconfirmed_effect');
  if (current.length !== target.length || current.some((tag) => !target.includes(tag)))
    throw new Error('unconfirmed_effect');
  return { expected, target, owned, ownershipRecorded };
}

function tagDestinationMatches(
  route: NonNullable<Awaited<ReturnType<typeof readWorkRoute>>>,
  home: NonNullable<Awaited<ReturnType<typeof readProjectHome>>>,
): boolean {
  return route.destination.kind === 'forum'
    ? route.destination.channelId === home.destination.channelId
    : route.destination.kind === 'category' &&
        route.destination.channelId === home.destination.parentId;
}

function tagRouteMatches(
  conversation: WorkConversation,
  home: NonNullable<Awaited<ReturnType<typeof readProjectHome>>>,
  route: NonNullable<Awaited<ReturnType<typeof readWorkRoute>>>,
  revision: unknown,
): boolean {
  return (
    route.revision === revision &&
    sameNotionWorkId(route.sourceId, conversation.subject.sourceId) &&
    tagDestinationMatches(route, home) &&
    (!conversation.managedForumTags || conversation.managedForumTags.routeId === route.id)
  );
}

async function loadTagSyncLink(db: Db, op: WorkOperation, context: WorkEffectContext) {
  const p = notionObject(JSON.parse(op.payload_json) as unknown);
  const conversation = op.conversation_id
    ? await readWorkConversation(db, context.scope, op.conversation_id)
    : null;
  const home = conversation ? await readProjectHome(db, context.scope, conversation.homeId) : null;
  const route =
    typeof p.routeId === 'string' ? await readWorkRoute(db, context.scope, p.routeId) : null;
  if (
    p.intent !== 'tag-sync' ||
    conversation?.state !== 'active' ||
    conversation.generation !== op.generation ||
    home?.state !== 'active' ||
    home.destination.kind !== 'forum' ||
    route?.state !== 'active' ||
    !route.tagSync ||
    !tagRouteMatches(conversation, home, route, p.routeRevision)
  )
    throw new Error('link_changed');
  return { conversation, home, route, tagSync: route.tagSync };
}

async function verifyTagSyncAudience(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  {
    context,
    link,
  }: { context: WorkEffectContext; link: Awaited<ReturnType<typeof loadTagSyncLink>> },
) {
  const { conversation, home, route, tagSync } = link;
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject: conversation.subject,
      taskSourceId: context.taskSourceId,
      homeId: home.id,
      conversationId: conversation.id,
      generation: conversation.generation,
      discordUserId: op.actor_discord_id,
      action: 'manage_home',
    },
    context.clock(),
  );
  if (actor?.personId !== op.actor_person_id || actor.grantVersion !== op.grant_version)
    throw new Error('authority_changed');
  if (!(await currentWorkAudience(db, providers, conversation)))
    throw new Error('audience_changed');
  const [forum, destination, page] = await Promise.all([
    providers.discord.inspectDestination(home.destination.channelId),
    providers.discord.inspectDestination(route.destination.channelId),
    providers.notion.readPage(conversation.subject.pageId),
  ]);
  const pageRow = notionObject(page);
  if (
    forum.destination.kind !== 'forum' ||
    forum.audienceFingerprint !== home.audienceFingerprint ||
    destination.audienceFingerprint !== route.audienceFingerprint ||
    !destination.canRead ||
    !sameNotionWorkId(pageRow.id, conversation.subject.pageId) ||
    !sameNotionWorkId(notionObject(pageRow.parent).data_source_id, conversation.subject.sourceId) ||
    pageRow.archived === true ||
    pageRow.in_trash === true
  )
    throw new Error('audience_changed');
  const mapped = resolveMappedForumTag(page, tagSync, forum.tags);
  if (mapped.kind !== 'ready') throw new Error('tag_mapping_unavailable');
  return { forum, mapped };
}

async function finishTagSync(
  db: Db,
  op: WorkOperation,
  context: WorkEffectContext,
  {
    link,
    previous,
    owned,
    ownershipRecorded,
  }: {
    link: Awaited<ReturnType<typeof loadTagSyncLink>>;
    previous: WorkConversation['managedForumTags'] | null;
    owned: string[];
    ownershipRecorded: boolean;
  },
): Promise<WorkResult> {
  const { conversation, route } = link;
  if (
    !ownershipRecorded &&
    !(await commitManagedForumTags(
      db,
      {
        conversation,
        operationId: op.id,
        claimToken: op.claim_token,
        routeId: route.id,
        routeRevision: route.revision,
        previous,
        tagIds: owned,
      },
      context.clock(),
    ))
  )
    throw new Error('unconfirmed_effect');
  const confirmed = await settleWorkOperation(
    db,
    { id: op.id, token: op.claim_token },
    { state: 'confirmed' },
    context.clock(),
  );
  return confirmed ? { kind: 'progress' } : { kind: 'paused', reason: 'unconfirmed_effect' };
}

/** Recheck the current route and audience; checkpoint the intended effect before calling Discord. */
export async function processWorkTagSync(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  if (!context.enabled || op.state !== 'processing') return { kind: 'idle' };
  try {
    const link = await loadTagSyncLink(db, op, context);
    const { conversation, home, route } = link;
    const { forum, mapped } = await verifyTagSyncAudience(db, providers, op, { context, link });
    const current = await providers.discord.readForumTags(
      home.destination.channelId,
      conversation.threadId,
    );
    const previous = conversation.managedForumTags ?? null;
    const saved = notionObject(op.result_json ? (JSON.parse(op.result_json) as unknown) : null);
    let expected: string[], target: string[], owned: string[];
    let ownershipRecorded = false;
    if (op.result_json) {
      ({ expected, target, owned, ownershipRecorded } = recoverTagCheckpoint(
        saved,
        current,
        mapped.tagId,
        { previous, routeId: route.id },
      ));
    } else {
      const plan = planManagedForumTags({
        current,
        managed: previous?.tagIds ?? [],
        desired: [mapped.tagId],
        available: forum.tags.map((tag) => tag.id),
        required: forum.requiredTag,
      });
      if (plan.kind !== 'update') throw new Error('tag_mapping_unavailable');
      expected = current;
      target = plan.tags;
      owned = plan.managed;
      const checkpoint = await db
        .prepare(
          "UPDATE discord_work_operations SET result_json=?,updated_at=? WHERE id=? AND scope_key=? AND state='processing' AND claim_token=? AND lease_expires_at>? AND result_json IS NULL AND EXISTS(SELECT 1 FROM discord_work_routes r WHERE r.id=? AND r.scope_key=discord_work_operations.scope_key AND r.state='active' AND r.revision=?)",
        )
        .bind(
          JSON.stringify({ expected, target, owned, previous }),
          context.clock().toISOString(),
          op.id,
          op.scope_key,
          op.claim_token,
          context.clock().toISOString(),
          route.id,
          route.revision,
        )
        .run();
      if (!checkpoint.meta.changes) throw new Error('link_changed');
      await providers.discord.updateForumTags({
        forumId: home.destination.channelId,
        threadId: conversation.threadId,
        expectedTags: expected,
        tags: target,
      });
    }
    return await finishTagSync(db, op, context, { link, previous, owned, ownershipRecorded });
  } catch (error) {
    return handleTagSyncFailure(db, op, context, error);
  }
}
