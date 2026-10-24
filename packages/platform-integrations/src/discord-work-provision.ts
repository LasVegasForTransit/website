import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  saveProjectHome,
  saveWorkConversation,
  readProjectHome,
  listWorkConversations,
  findWorkSubject,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  enqueueWorkOperation,
  settleWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { authorizeWork, readWorkSource, readWorkTask } from './discord-work-authority';
import { projectWorkCard, sharedTaskCard } from './discord-work-cards';
import { workSubject, workString } from './discord-work-input';
import { notionObject } from './notion-task-types';
import { workFailure, type WorkProviders, type WorkEffectContext } from './discord-work-actions';
import type {
  WorkOperation,
  WorkConversation,
  ProjectHome,
  WorkActor,
  WorkResult,
} from './discord-work-types';
import type { CreatedConversation, DestinationInspection } from './discord-work-provider';
import type { DiscordTaskMessage } from './notion-task-cards';
type Payload = Record<string, unknown>;
function markedCard(card: DiscordTaskMessage, id: string): DiscordTaskMessage {
  const result = structuredClone(card);
  for (const container of result.components)
    for (const section of container.components ?? []) {
      if (section.accessory?.url) {
        const url = new URL(section.accessory.url);
        url.searchParams.set('lvbt_work_create', id);
        section.accessory.url = url.href;
      }
    }
  return result;
}
async function checkpoint(
  db: Db,
  op: WorkOperation,
  value: Record<string, unknown>,
): Promise<void> {
  const result = await db
    .prepare(
      "UPDATE discord_work_operations SET result_json=? WHERE id=? AND state='processing' AND claim_token=?",
    )
    .bind(JSON.stringify(value), op.id, op.claim_token)
    .run();
  if (!result.meta.changes) throw new Error('provision_lease_changed');
  op.result_json = JSON.stringify(value);
}
async function assertProvisionCurrent(
  db: Db,
  op: WorkOperation,
  home?: ProjectHome,
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT 1 FROM discord_work_operations WHERE id=? AND scope_key=? AND claim_token=? AND state='processing' AND (? IS NULL OR EXISTS(SELECT 1 FROM discord_project_homes WHERE id=? AND scope_key=? AND generation=? AND state='active'))`,
    )
    .bind(
      op.id,
      op.scope_key,
      op.claim_token,
      home?.id ?? null,
      home?.id ?? null,
      op.scope_key,
      home?.generation ?? 0,
    )
    .first();
  if (!row) throw new Error('link_changed');
}
function skeleton(op: WorkOperation, p: Payload, context: WorkEffectContext): WorkConversation {
  const subject = workSubject(p.subject),
    id = workString(p.linkId);
  if (!subject || !id) throw new Error('invalid_work_subject');
  return {
    id,
    scope: context.scope,
    subject,
    homeId: op.home_id ?? workString(p.homeId) ?? '',
    placementProjectId: workString(p.projectId) ?? '',
    threadId: '0',
    starterMessageId: '0',
    mode: p.mode === 'automatic' ? 'automatic' : 'selected',
    state: 'active',
    generation: 1,
    activationId: '0',
    cursorId: '0',
    windowUpperId: null,
    windowBeforeId: null,
    footerBlockIds: [],
  };
}
async function destinationFor(
  db: Db,
  providers: WorkProviders,
  p: Payload,
  op: WorkOperation,
): Promise<DestinationInspection> {
  const id = workString(p.destinationId);
  if (!id) throw new Error('destination_required');
  const d = await providers.discord.inspectDestination(id);
  if (d.audienceFingerprint !== p.audienceFingerprint) throw new Error('audience_changed');
  const result = notionObject(op.result_json ? (JSON.parse(op.result_json) as unknown) : null);
  if (p.createForum === true) {
    if (!d.isCategory || !d.canManageChannels) throw new Error('forum_permission_required');
    const existing = workString(result.forumId);
    await assertProvisionCurrent(db, op);
    const forum = existing
      ? { channelId: existing }
      : await providers.discord.createProjectForum({
          categoryId: id,
          name: String(p.title).slice(0, 100),
          projectUrl: `https://www.notion.so/${workSubject(p.subject)?.pageId ?? ''}`,
          operationId: op.id,
        });
    await checkpoint(db, op, { ...result, forumId: forum.channelId });
    return providers.discord.inspectDestination(forum.channelId);
  }
  if (d.isCategory) throw new Error('category_requires_forum_creation');
  return d;
}
async function overview(
  db: Db,
  providers: WorkProviders,
  input: { op: WorkOperation; p: Payload; home: ProjectHome },
  context: WorkEffectContext,
): Promise<WorkConversation> {
  const { op, p, home } = input;
  const c = {
    ...skeleton(op, { ...p, linkId: `overview-${home.id}` }, context),
    homeId: home.id,
    placementProjectId: home.projectId,
  };
  const d = await providers.discord.inspectDestination(home.destination.channelId);
  const card = markedCard(
    projectWorkCard(
      home,
      { title: String(p.title), url: `https://www.notion.so/${home.projectId}` },
      'active',
    ),
    op.id,
  );
  const prior = notionObject(op.result_json ? (JSON.parse(op.result_json) as unknown) : null);
  await assertProvisionCurrent(db, op, home);
  let created: CreatedConversation;
  if (typeof prior.threadId === 'string' && typeof prior.starterMessageId === 'string')
    created = {
      threadId: prior.threadId,
      starterMessageId: prior.starterMessageId,
      ...(typeof prior.cardChannelId === 'string' ? { cardChannelId: prior.cardChannelId } : {}),
    };
  else if (d.destination.kind === 'forum')
    created = await providers.discord.createTaskConversation({
      destination: d,
      title: String(p.title),
      card,
      operationId: op.id,
      onStarter: (value) => checkpoint(db, op, { ...value, starterOnly: true }),
      tagIds: Array.isArray(p.tagIds)
        ? p.tagIds.filter((v): v is string => typeof v === 'string')
        : [],
    });
  else {
    const messageId = await providers.discord.sendCard(d.destination.channelId, card, op.id);
    created = {
      threadId: d.destination.channelId,
      starterMessageId: messageId,
      cardChannelId: d.destination.channelId,
    };
  }
  await checkpoint(db, op, { forumId: home.destination.channelId, ...created });
  return {
    ...c,
    ...created,
    activationId: created.starterMessageId,
    cursorId: created.starterMessageId,
  };
}
async function provisionHome(
  db: Db,
  providers: WorkProviders,
  input: { op: WorkOperation; p: Payload; actor: WorkActor },
  context: WorkEffectContext,
): Promise<WorkConversation> {
  const { op, p, actor } = input,
    subject = workSubject(p.subject),
    id = workString(p.linkId);
  if (subject?.kind !== 'project_plan' || !id) throw new Error('project_required');
  const previous = await readProjectHome(db, context.scope, id);
  if (previous && (previous.state !== 'active' || previous.generation !== op.generation))
    throw new Error('link_changed');
  const d = await destinationFor(db, providers, p, op);
  const home: ProjectHome = {
    id,
    scope: context.scope,
    projectSourceId: subject.sourceId,
    taskSourceId: context.taskSourceId,
    projectId: subject.pageId,
    destination: d.destination,
    taskParent: null,
    audienceFingerprint: d.audienceFingerprint,
    approvedBy: actor.personId,
    state: 'active',
    generation: 1,
    title: String(p.title),
  };
  const existing = await readProjectHome(db, context.scope, id);
  if (existing && (existing.state !== 'active' || existing.generation !== op.generation))
    throw new Error('link_changed');
  if (!existing && !(await saveProjectHome(db, home, 0, context.clock())))
    throw new Error('project_already_linked');
  await db
    .prepare(
      "UPDATE discord_work_operations SET home_id=? WHERE id=? AND claim_token=? AND state='processing'",
    )
    .bind(id, op.id, op.claim_token)
    .run();
  op.home_id = id;
  const conversations = await listWorkConversations(db, context.scope, id);
  const existingConversation = conversations.find(
    (v) => v.subject.kind === 'project_plan' && v.subject.pageId === home.projectId,
  );
  if (existingConversation) return existingConversation;
  const c = await overview(db, providers, { op, p, home: existing ?? home }, context);
  if (!(await saveWorkConversation(db, c, 0, context.clock())))
    throw new Error('overview_link_conflict');
  await db
    .prepare(
      "UPDATE discord_project_homes SET data_json=json_set(data_json,'$.summaryMessageId',?,'$.summaryChannelId',?) WHERE id=? AND scope_key=?",
    )
    .bind(c.starterMessageId, c.threadId, home.id, op.scope_key)
    .run();
  return c;
}
async function createOrRecover(
  db: Db,
  providers: WorkProviders,
  input: {
    op: WorkOperation;
    p: Payload;
    d: DestinationInspection;
    card: DiscordTaskMessage;
    title: string;
  },
): Promise<CreatedConversation> {
  const { op, p, d, card, title } = input;
  const prior = notionObject(op.result_json ? (JSON.parse(op.result_json) as unknown) : null);
  let created: CreatedConversation;
  if (
    prior.starterOnly === true &&
    typeof prior.starterMessageId === 'string' &&
    typeof prior.cardChannelId === 'string'
  )
    return providers.discord.resumeStarter({
      channelId: prior.cardChannelId,
      starterMessageId: prior.starterMessageId,
      title,
    });
  if (typeof prior.threadId === 'string' && typeof prior.starterMessageId === 'string')
    created = {
      threadId: prior.threadId,
      starterMessageId: prior.starterMessageId,
      ...(typeof prior.cardChannelId === 'string' ? { cardChannelId: prior.cardChannelId } : {}),
    };
  else if (d.destination.kind === 'thread') {
    const messageId = await providers.discord.sendCard(d.destination.channelId, card, op.id);
    created = {
      threadId: d.destination.channelId,
      starterMessageId: messageId,
      cardChannelId: d.destination.channelId,
    };
  } else
    created = await providers.discord.createTaskConversation({
      destination: d,
      title: title,
      card,
      operationId: op.id,
      onStarter: (value) => checkpoint(db, op, { ...value, starterOnly: true }),
      tagIds: Array.isArray(p.tagIds)
        ? p.tagIds.filter((v): v is string => typeof v === 'string')
        : [],
    });
  return created;
}
async function provisionTask(
  db: Db,
  providers: WorkProviders,
  input: { op: WorkOperation; p: Payload },
  context: WorkEffectContext,
): Promise<WorkConversation> {
  const { op, p } = input,
    c = skeleton(op, p, context),
    home = await readProjectHome(db, context.scope, c.homeId);
  if (home?.state !== 'active') throw new Error('project_home_required');
  const existing = await findWorkSubject(db, context.scope, c.subject);
  if (existing) return existing;
  const source = await readWorkSource(db, context.taskSourceId, context.scope);
  const task = source ? await readWorkTask(providers, source, c.subject) : null;
  if (!task?.projectIds.includes(home.projectId)) throw new Error('task_project_changed');
  const approved = await providers.discord.inspectDestination(home.destination.channelId);
  if (approved.audienceFingerprint !== home.audienceFingerprint)
    throw new Error('audience_changed');
  const d = await destinationFor(db, providers, p, op);
  if (home.destination.kind === 'thread') c.mode = 'selected';
  if (c.mode === 'automatic' && !(await providers.discord.messageContentAvailable()))
    throw new Error('message_content_required');
  const card = markedCard(sharedTaskCard(c, task, 'active'), op.id);
  await assertProvisionCurrent(db, op, home);
  const created = await createOrRecover(db, providers, { op, p, d, card, title: task.title });
  await checkpoint(db, op, { ...created });
  const ready = {
    ...c,
    ...created,
    placementProjectId: home.projectId,
    activationId: created.starterMessageId,
    cursorId: created.starterMessageId,
  };
  if (!(await saveWorkConversation(db, ready, 0, context.clock())))
    throw new Error('conversation_already_linked');
  return ready;
}
async function provision(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkConversation> {
  const p = notionObject(JSON.parse(op.payload_json) as unknown),
    subject = workSubject(p.subject);
  if (!subject) throw new Error('invalid_work_subject');
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject,
      discordUserId: op.actor_discord_id,
      action: p.intent === 'home' ? 'manage_home' : 'place_work',
      taskSourceId: context.taskSourceId,
      homeId: op.home_id ?? undefined,
    },
    context.clock(),
  );
  if (actor?.personId !== op.actor_person_id || actor.grantVersion !== op.grant_version)
    throw new Error('authority_changed');
  return p.intent === 'home'
    ? provisionHome(db, providers, { op, p, actor }, context)
    : provisionTask(db, providers, { op, p }, context);
}
export async function processWorkProvision(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  if (!context.enabled || op.state !== 'processing') return { kind: 'idle' };
  try {
    const c = await provision(db, providers, op, context);
    await enqueueWorkOperation(
      db,
      {
        id: crypto.randomUUID(),
        scope: context.scope,
        homeId: c.homeId,
        conversationId: c.id,
        generation: c.generation,
        kind: 'backlink',
        sourceKey: `backlink:${c.id}`,
        actorPersonId: op.actor_person_id,
        actorDiscordId: op.actor_discord_id,
        grantVersion: op.grant_version,
        originalAuthorId: op.original_author_id,
        payload: { taskSourceId: context.taskSourceId },
      },
      context.clock(),
    );
    await settleWorkOperation(
      db,
      { id: op.id, token: op.claim_token },
      { state: 'confirmed', providerIds: { conversationId: c.id } },
      context.clock(),
    );
    return { kind: 'progress' };
  } catch (error) {
    const outcome = workFailure(error);
    await settleWorkOperation(db, { id: op.id, token: op.claim_token }, outcome, context.clock());
    return { kind: 'paused', reason: outcome.reason };
  }
}
