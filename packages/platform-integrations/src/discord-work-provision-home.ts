import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  saveProjectHome,
  saveWorkConversation,
  readProjectHome,
  listWorkConversations,
  hasOtherProjectHome,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { validateAdoptedThread } from './discord-work-adopt-destination';
import { projectWorkCard } from './discord-work-cards';
import { workSubject, workString } from './discord-work-input';
import { notionObject } from './notion-task-types';
import { assertProvisionCurrent, checkpoint } from './discord-work-provision-checkpoint';
import { destinationFor } from './discord-work-provision-destination';
import { markedCard, skeleton } from './discord-work-provision-common';
import type { WorkProviders, WorkEffectContext } from './discord-work-actions';
import type { WorkOperation, WorkConversation, ProjectHome, WorkActor } from './discord-work-types';
import type { CreatedConversation } from './discord-work-provider';
type Payload = Record<string, unknown>;

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
  const adoptedId = workString(p.adoptThreadId);
  const target = adoptedId ? await providers.discord.inspectDestination(adoptedId) : d;
  if (
    adoptedId &&
    (d.destination.kind !== 'forum' ||
      !validateAdoptedThread({
        thread: target,
        expectedParentId: home.destination.channelId,
        approvedAudience: home.audienceFingerprint,
      }))
  )
    throw new Error('audience_changed');
  const card = markedCard(
    projectWorkCard(
      home,
      { title: String(p.title), url: `https://www.notion.so/${home.projectId}` },
      'active',
    ),
    op.id,
  );
  const prior = notionObject(op.result_json ? (JSON.parse(op.result_json) as unknown) : null);
  await assertProvisionCurrent(db, op, context.clock, home);
  let created: CreatedConversation;
  if (
    prior.postPhase === 'not_started' &&
    !(typeof prior.threadId === 'string' && typeof prior.starterMessageId === 'string')
  )
    await checkpoint(db, op, { ...prior, postPhase: 'attempted' }, context.clock);
  if (typeof prior.threadId === 'string' && typeof prior.starterMessageId === 'string')
    created = {
      threadId: prior.threadId,
      starterMessageId: prior.starterMessageId,
      ...(typeof prior.cardChannelId === 'string' ? { cardChannelId: prior.cardChannelId } : {}),
    };
  else if (target.destination.kind === 'forum')
    created = await providers.discord.createTaskConversation({
      destination: target,
      title: String(p.title),
      card,
      operationId: op.id,
      onStarter: (value) => checkpoint(db, op, { ...value, starterOnly: true }, context.clock),
      tagIds: Array.isArray(p.tagIds)
        ? p.tagIds.filter((v): v is string => typeof v === 'string')
        : [],
    });
  else {
    const messageId = await providers.discord.sendCard(target.destination.channelId, card, op.id);
    created = {
      threadId: target.destination.channelId,
      starterMessageId: messageId,
      cardChannelId: target.destination.channelId,
    };
  }
  await checkpoint(db, op, { forumId: home.destination.channelId, ...created }, context.clock);
  return {
    ...c,
    ...created,
    activationId: created.starterMessageId,
    cursorId: created.starterMessageId,
  };
}
async function pinProjectOverview(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    op,
    p,
    home,
    existing,
    c,
  }: {
    op: WorkOperation;
    p: Payload;
    home: ProjectHome;
    existing: ProjectHome | null;
    c: WorkConversation;
  },
): Promise<void> {
  if (!existing?.overviewPin) {
    await assertProvisionCurrent(db, op, context.clock, home);
    let pin: 'pinned' | 'needs_attention' = 'pinned';
    try {
      await providers.discord.pinWorkMessage(c.cardChannelId ?? c.threadId, c.starterMessageId);
    } catch {
      pin = 'needs_attention';
    }
    await db
      .prepare(
        "UPDATE discord_project_homes SET data_json=json_set(data_json,'$.overviewPin',?) WHERE id=? AND scope_key=? AND generation=? AND state='active' AND EXISTS(SELECT 1 FROM discord_work_operations o WHERE o.id=? AND o.scope_key=discord_project_homes.scope_key AND o.state='processing' AND o.claim_token=? AND o.lease_expires_at>?)",
      )
      .bind(
        pin,
        home.id,
        op.scope_key,
        home.generation,
        op.id,
        op.claim_token,
        context.clock().toISOString(),
      )
      .run();
  }
  if (home.destination.kind === 'forum' && p.createForum === true && !existing?.overviewPostPin) {
    await assertProvisionCurrent(db, op, context.clock, home);
    let pin: 'pinned' | 'needs_attention' = 'pinned';
    try {
      await providers.discord.pinForumPost(home.destination.channelId, c.threadId);
    } catch {
      pin = 'needs_attention';
    }
    await db
      .prepare(
        "UPDATE discord_project_homes SET data_json=json_set(data_json,'$.overviewPostPin',?) WHERE id=? AND scope_key=? AND generation=? AND state='active' AND EXISTS(SELECT 1 FROM discord_work_operations o WHERE o.id=? AND o.scope_key=discord_project_homes.scope_key AND o.state='processing' AND o.claim_token=? AND o.lease_expires_at>?)",
      )
      .bind(
        pin,
        home.id,
        op.scope_key,
        home.generation,
        op.id,
        op.claim_token,
        context.clock().toISOString(),
      )
      .run();
  }
}

function staleProjectHome(home: ProjectHome | null, generation: number): boolean {
  return !!home && (home.state !== 'active' || home.generation !== generation);
}

export async function provisionHome(
  db: Db,
  providers: WorkProviders,
  input: { op: WorkOperation; p: Payload; actor: WorkActor },
  context: WorkEffectContext,
): Promise<WorkConversation> {
  const { op, p, actor } = input,
    subject = workSubject(p.subject),
    id = workString(p.linkId);
  if (subject?.kind !== 'project_plan' || !id) throw new Error('project_required');
  if (
    await hasOtherProjectHome(db, context.scope, {
      sourceId: subject.sourceId,
      projectId: subject.pageId,
      exceptId: id,
    })
  )
    throw new Error('project_already_linked');
  const previous = await readProjectHome(db, context.scope, id);
  if (staleProjectHome(previous, op.generation)) throw new Error('link_changed');
  const d = await destinationFor(db, providers, { p, op }, context.clock);
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
  if (staleProjectHome(existing, op.generation)) throw new Error('link_changed');
  await assertProvisionCurrent(db, op, context.clock);
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
  const c =
    existingConversation ??
    (await overview(db, providers, { op, p, home: existing ?? home }, context));
  if (!existingConversation && !(await saveWorkConversation(db, c, 0, context.clock())))
    throw new Error('overview_link_conflict');
  await db
    .prepare(
      "UPDATE discord_project_homes SET data_json=json_set(data_json,'$.summaryMessageId',?,'$.summaryChannelId',?) WHERE id=? AND scope_key=?",
    )
    .bind(c.starterMessageId, c.threadId, home.id, op.scope_key)
    .run();
  await pinProjectOverview(db, providers, context, { op, p, home, existing, c });
  return c;
}
