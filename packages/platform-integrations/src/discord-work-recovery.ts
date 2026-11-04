import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  workScopeKey,
  type WorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-types';
import {
  operationConversation,
  recoverWorkComment,
  currentWorkAudience,
  type WorkProviders,
  type WorkEffectContext,
} from './discord-work-actions';
import { inspectFooterRecovery } from './notion-work-links';
import {
  readProjectHome,
  readWorkConversation,
  saveWorkFooterBlockIds,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { readWorkRoute } from '@lasvegasfortransit/platform-storage/discord-work-routes';
import { sameNotionWorkId, workString, workSubject } from './discord-work-input';
import { notionObject } from './notion-task-types';
import type { WorkResult } from './discord-work-types';
function topicIdentityMatches(
  home: NonNullable<Awaited<ReturnType<typeof readProjectHome>>>,
  subject: NonNullable<ReturnType<typeof workSubject>>,
  p: Record<string, unknown>,
): boolean {
  return (
    sameNotionWorkId(home.projectId, subject.pageId) &&
    sameNotionWorkId(home.projectSourceId, subject.sourceId) &&
    p.topic === `Project plan: https://www.notion.so/${home.projectId.replaceAll('-', '')}`
  );
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((tag) => typeof tag === 'string');
}
function sameTagSet(current: string[], target: string[]): boolean {
  return current.length === target.length && current.every((tag) => target.includes(tag));
}

function recoveryForumMatches(
  forum: Awaited<ReturnType<WorkProviders['discord']['inspectDestination']>>,
  home: NonNullable<Awaited<ReturnType<typeof readProjectHome>>>,
): boolean {
  return (
    forum.destination.kind === 'forum' &&
    forum.destination.parentId === home.destination.parentId &&
    forum.canRead &&
    forum.audienceFingerprint === home.audienceFingerprint
  );
}
function activeRecoveryConversation(
  c: NonNullable<Awaited<ReturnType<typeof operationConversation>>>,
  op: WorkOperation,
): boolean {
  return c.state === 'active' && c.generation === op.generation;
}

async function recoverTopic(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  const p = notionObject(JSON.parse(op.payload_json) as unknown);
  const subject = workSubject(p.subject);
  const home = op.home_id ? await readProjectHome(db, context.scope, op.home_id) : null;
  if (
    subject?.kind !== 'project_plan' ||
    home?.state !== 'active' ||
    home.generation !== op.generation ||
    home.destination.kind !== 'forum' ||
    home.destination.channelId !== p.forumId ||
    home.audienceFingerprint !== p.audienceFingerprint ||
    !topicIdentityMatches(home, subject, p)
  )
    return { kind: 'paused', reason: 'unconfirmed_effect' };
  const forum = await providers.discord.inspectDestination(home.destination.channelId);
  if (
    !recoveryForumMatches(forum, home) ||
    (await providers.discord.readForumTopic(home.destination.channelId)) !== p.topic
  )
    return { kind: 'paused', reason: 'unconfirmed_effect' };
  const result = await db
    .prepare(
      "UPDATE discord_work_operations SET state='confirmed',reason=NULL,updated_at=? WHERE id=? AND scope_key=? AND state='held' AND EXISTS(SELECT 1 FROM discord_project_homes h WHERE h.id=discord_work_operations.home_id AND h.scope_key=discord_work_operations.scope_key AND h.state='active' AND h.generation=discord_work_operations.generation)",
    )
    .bind(context.clock().toISOString(), op.id, op.scope_key)
    .run();
  return result.meta.changes ? { kind: 'progress' } : { kind: 'paused', reason: 'link_changed' };
}

async function recoverDestination(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  const p = notionObject(JSON.parse(op.payload_json) as unknown);
  if (
    p.kind !== 'category' &&
    ((p.kind !== 'text' && p.kind !== 'forum') || typeof p.parentId !== 'string')
  )
    return { kind: 'paused', reason: 'unconfirmed_effect' };
  const channelId =
    p.kind === 'category'
      ? await providers.discord.findCreatedCategory(op.id)
      : await providers.discord.findRouteDestination({
          kind: p.kind,
          parentId: String(p.parentId),
          operationId: op.id,
        });
  if (!channelId) return { kind: 'paused', reason: 'unconfirmed_effect' };
  const result = await db
    .prepare(
      "UPDATE discord_work_operations SET state='queued',result_json=?,attempts=0,next_attempt_at=?,reason='recovered_destination',updated_at=? WHERE scope_key=? AND id=? AND state='held'",
    )
    .bind(
      JSON.stringify({ channelId }),
      context.clock().toISOString(),
      context.clock().toISOString(),
      op.scope_key,
      op.id,
    )
    .run();
  return result.meta.changes ? { kind: 'progress' } : { kind: 'paused', reason: 'link_changed' };
}

function overviewProofMatches(
  prior: Record<string, unknown>,
  home: NonNullable<Awaited<ReturnType<typeof readProjectHome>>>,
  conversation: NonNullable<Awaited<ReturnType<typeof readWorkConversation>>>,
): boolean {
  return (
    prior.threadId === conversation.threadId &&
    prior.starterMessageId === conversation.starterMessageId &&
    prior.forumId === home.destination.channelId
  );
}

async function recoverExistingOverview(
  db: Db,
  op: WorkOperation,
  context: WorkEffectContext,
  { p, prior }: { p: Record<string, unknown>; prior: Record<string, unknown> },
): Promise<WorkResult | null> {
  const linkId = workString(p.linkId);
  if (p.intent === 'home' && linkId && op.home_id === linkId) {
    const [home, conversation] = await Promise.all([
      readProjectHome(db, context.scope, linkId),
      readWorkConversation(db, context.scope, `overview-${linkId}`),
    ]);
    if (
      home?.state === 'active' &&
      home.generation === op.generation &&
      conversation?.state === 'active' &&
      conversation.homeId === home.id &&
      conversation.generation === op.generation &&
      JSON.stringify(conversation.subject) === JSON.stringify(p.subject) &&
      overviewProofMatches(prior, home, conversation)
    ) {
      const result = await db
        .prepare(
          "UPDATE discord_work_operations SET state='queued',attempts=0,next_attempt_at=?,reason='recovered_overview',updated_at=? WHERE scope_key=? AND id=? AND state='held'",
        )
        .bind(context.clock().toISOString(), context.clock().toISOString(), op.scope_key, op.id)
        .run();
      return result.meta.changes
        ? { kind: 'progress' }
        : { kind: 'paused', reason: 'link_changed' };
    }
  }
  return null;
}

async function recoverForumOnly(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  {
    context,
    p,
    prior,
    destinationId,
  }: {
    context: WorkEffectContext;
    p: Record<string, unknown>;
    prior: Record<string, unknown>;
    destinationId: string;
  },
): Promise<WorkResult | null> {
  if (
    p.intent === 'home' &&
    p.createForum === true &&
    prior.postPhase === 'not_started' &&
    typeof prior.forumId === 'string'
  ) {
    const forum = await providers.discord.inspectDestination(prior.forumId);
    if (
      forum.destination.kind !== 'forum' ||
      forum.destination.channelId !== prior.forumId ||
      forum.destination.parentId !== destinationId ||
      !forum.canRead ||
      !forum.canSend ||
      forum.audienceFingerprint !== p.audienceFingerprint
    )
      return { kind: 'paused', reason: 'unconfirmed_effect' };
    const result = await db
      .prepare(
        "UPDATE discord_work_operations SET state='queued',attempts=0,next_attempt_at=?,reason='recovered_forum',updated_at=? WHERE scope_key=? AND id=? AND state='held' AND result_json=?",
      )
      .bind(
        context.clock().toISOString(),
        context.clock().toISOString(),
        op.scope_key,
        op.id,
        op.result_json,
      )
      .run();
    return result.meta.changes ? { kind: 'progress' } : { kind: 'paused', reason: 'link_changed' };
  }
  return null;
}

async function recoverProvision(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  const p = notionObject(JSON.parse(op.payload_json) as unknown),
    destinationId = workString(p.destinationId);
  if (p.intent === 'project-topic') return recoverTopic(db, providers, op, context);
  if (p.intent === 'destination') return recoverDestination(db, providers, op, context);
  if (!destinationId) return { kind: 'paused', reason: 'unconfirmed_effect' };
  const prior = notionObject(op.result_json ? (JSON.parse(op.result_json) as unknown) : {});
  const overview = await recoverExistingOverview(db, op, context, { p, prior });
  if (overview) return overview;
  const forum = await recoverForumOnly(db, providers, op, { context, p, prior, destinationId });
  if (forum) return forum;
  const proof = await providers.discord.discoverWork({
    destinationId: workString(p.adoptThreadId) ?? destinationId,
    operationId: op.id,
    createForum: p.createForum === true,
    isTask: p.intent === 'task' || p.intent === 'event',
  });
  if (
    !proof?.threadId ||
    (['forumId', 'threadId', 'starterMessageId', 'cardChannelId'] as const).some(
      (key) =>
        typeof prior[key] === 'string' &&
        typeof proof[key] === 'string' &&
        prior[key] !== proof[key],
    )
  )
    return { kind: 'paused', reason: 'unconfirmed_effect' };
  // The next attempt rechecks authority, generation, source, and audience before any write.
  const recovered = await db
    .prepare(
      "UPDATE discord_work_operations SET state='queued',result_json=?,attempts=0,next_attempt_at=?,reason='recovered_creation',updated_at=? WHERE scope_key=? AND id=? AND state='held'",
    )
    .bind(
      JSON.stringify({ ...prior, ...proof }),
      context.clock().toISOString(),
      context.clock().toISOString(),
      op.scope_key,
      op.id,
    )
    .run();
  return recovered.meta.changes ? { kind: 'progress' } : { kind: 'paused', reason: 'link_changed' };
}
async function recoverTags(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  {
    context,
    c,
  }: {
    context: WorkEffectContext;
    c: NonNullable<Awaited<ReturnType<typeof operationConversation>>>;
  },
): Promise<WorkResult> {
  const payload = notionObject(JSON.parse(op.payload_json) as unknown);
  const checkpoint = notionObject(op.result_json ? (JSON.parse(op.result_json) as unknown) : null);
  const home = await readProjectHome(db, context.scope, c.homeId);
  const route =
    typeof payload.routeId === 'string'
      ? await readWorkRoute(db, context.scope, payload.routeId)
      : null;
  if (
    home?.state !== 'active' ||
    home.destination.kind !== 'forum' ||
    !activeRecoveryConversation(c, op) ||
    route?.state !== 'active' ||
    route.revision !== payload.routeRevision ||
    !route.tagSync ||
    !isStringArray(checkpoint.target) ||
    !(await currentWorkAudience(db, providers, c))
  )
    return { kind: 'paused', reason: 'unconfirmed_effect' };
  const current = await providers.discord.readForumTags(home.destination.channelId, c.threadId);
  if (!sameTagSet(current, checkpoint.target))
    return { kind: 'paused', reason: 'unconfirmed_effect' };
  const result = await db
    .prepare(
      "UPDATE discord_work_operations SET state='queued',attempts=0,next_attempt_at=?,reason='recovered_tags',updated_at=? WHERE scope_key=? AND id=? AND state='held' AND EXISTS(SELECT 1 FROM discord_work_routes r WHERE r.id=? AND r.scope_key=discord_work_operations.scope_key AND r.state='active' AND r.revision=?) AND EXISTS(SELECT 1 FROM discord_work_conversations c WHERE c.id=discord_work_operations.conversation_id AND c.scope_key=discord_work_operations.scope_key AND c.state='active' AND c.generation=discord_work_operations.generation)",
    )
    .bind(
      context.clock().toISOString(),
      context.clock().toISOString(),
      op.scope_key,
      op.id,
      route.id,
      route.revision,
    )
    .run();
  return result.meta.changes ? { kind: 'progress' } : { kind: 'paused', reason: 'link_changed' };
}

async function recoverHeld(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  if (op.kind === 'provision') return recoverProvision(db, providers, op, context);
  const c = await operationConversation(db, op, context);
  if (!c) return { kind: 'paused', reason: 'unconfirmed_effect' };
  const payload = notionObject(JSON.parse(op.payload_json) as unknown);
  if (op.kind === 'refresh' && payload.intent === 'tag-sync')
    return recoverTags(db, providers, op, { context, c });
  if (op.kind === 'comment')
    return recoverWorkComment(
      db,
      providers.notion,
      { scope: context.scope, operation: op, conversation: c },
      context.clock(),
    );
  const footer = await inspectFooterRecovery(providers.notion, c);
  if (footer.kind === 'unknown') return { kind: 'paused', reason: 'unconfirmed_effect' };
  if (footer.kind === 'retry') {
    const queued = await db
      .prepare(
        "UPDATE discord_work_operations SET state='queued',next_attempt_at=?,reason='recovered_footer',updated_at=? WHERE scope_key=? AND id=? AND state='held'",
      )
      .bind(context.clock().toISOString(), context.clock().toISOString(), op.scope_key, op.id)
      .run();
    return queued.meta.changes ? { kind: 'progress' } : { kind: 'paused', reason: 'link_changed' };
  }
  const saved = await saveWorkFooterBlockIds(
    db,
    { scope: c.scope, id: c.id, generation: c.generation, ids: footer.ids, heldOperationId: op.id },
    context.clock(),
  );
  if (!saved) return { kind: 'paused', reason: 'link_changed' };
  const confirmed = await db
    .prepare(
      "UPDATE discord_work_operations SET state='confirmed',result_json=?,reason=NULL,updated_at=? WHERE scope_key=? AND id=? AND state='held'",
    )
    .bind(
      JSON.stringify({ footerBlockIds: footer.ids }),
      context.clock().toISOString(),
      op.scope_key,
      op.id,
    )
    .run();
  return confirmed.meta.changes ? { kind: 'progress' } : { kind: 'paused', reason: 'link_changed' };
}
export async function recoverOneWorkOperation(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
): Promise<WorkResult> {
  const op = await db
    .prepare(
      "SELECT * FROM discord_work_operations WHERE scope_key=? AND state='held' AND reason IS NOT 'eligibility_changed_after_effect' AND (kind IN ('comment','backlink','provision') OR (kind='refresh' AND json_extract(payload_json,'$.intent')='tag-sync')) AND next_attempt_at<=? ORDER BY next_attempt_at,id LIMIT 1",
    )
    .bind(workScopeKey(context.scope), context.clock().toISOString())
    .first<WorkOperation>();
  if (!op) return { kind: 'idle' };
  await db
    .prepare(
      "UPDATE discord_work_operations SET next_attempt_at=? WHERE id=? AND scope_key=? AND state='held'",
    )
    .bind(new Date(context.clock().getTime() + 300_000).toISOString(), op.id, op.scope_key)
    .run();
  try {
    return await recoverHeld(db, providers, op, context);
  } catch {
    return { kind: 'paused', reason: 'unconfirmed_effect' };
  }
}
