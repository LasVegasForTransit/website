import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  saveProjectHome,
  saveWorkConversation,
  readProjectHome,
  findWorkSubject,
  hasOtherProjectHome,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  enqueueWorkOperation,
  settleWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { authorizeWork, readWorkSource, readWorkTask } from './discord-work-authority';
import { validateAdoptedThread } from './discord-work-adopt-destination';
import { eventWorkCard, sharedTaskCard } from './discord-work-cards';
import { sameNotionWorkId, workSubject, workString } from './discord-work-input';
import { notionObject } from './notion-task-types';
import { workFailure, type WorkProviders, type WorkEffectContext } from './discord-work-actions';
import type {
  WorkOperation,
  WorkConversation,
  ProjectHome,
  WorkActor,
  WorkResult,
} from './discord-work-types';
import { assertProvisionCurrent, checkpoint } from './discord-work-provision-checkpoint';
import { destinationFor } from './discord-work-provision-destination';
import { IneligibleWorkPage, refreshProvisionRoute } from './discord-work-provision-route';
import {
  managedCreatedName,
  markedCard,
  skeleton,
  createOrRecover,
} from './discord-work-provision-common';
import { provisionHome } from './discord-work-provision-home';
import { queueProjectPins } from './discord-work-project-pins';
type Payload = Record<string, unknown>;
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
  if (!task?.projectIds.some((projectId) => sameNotionWorkId(projectId, home.projectId)))
    throw new Error('task_project_changed');
  const approved = await providers.discord.inspectDestination(home.destination.channelId);
  if (approved.audienceFingerprint !== home.audienceFingerprint)
    throw new Error('audience_changed');
  const d = await destinationFor(db, providers, { p, op }, context.clock);
  if (home.destination.kind === 'thread') c.mode = 'selected';
  if (c.mode === 'automatic' && !(await providers.discord.messageContentAvailable()))
    throw new Error('message_content_required');
  const card = markedCard(sharedTaskCard(c, task, 'active'), op.id);
  await assertProvisionCurrent(db, op, context.clock, home);
  const created = await createOrRecover(
    db,
    providers,
    { op, p, d, card, title: task.title },
    context.clock,
  );
  await checkpoint(db, op, { ...created }, context.clock);
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
async function eventDestination(
  providers: WorkProviders,
  p: Payload,
  destination: Awaited<ReturnType<typeof destinationFor>>,
) {
  if (destination.isCategory || destination.destination.kind === 'thread')
    throw new Error('event_destination_required');
  const adoptedId = workString(p.adoptThreadId);
  const target = adoptedId ? await providers.discord.inspectDestination(adoptedId) : destination;
  if (
    adoptedId &&
    !validateAdoptedThread({
      thread: target,
      expectedParentId: destination.destination.channelId,
      approvedAudience: destination.audienceFingerprint,
    })
  )
    throw new Error('audience_changed');
  return target;
}

async function createEventConversation(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    op,
    p,
    home,
    target,
    subject,
  }: {
    op: WorkOperation;
    p: Payload;
    home: ProjectHome;
    target: Awaited<ReturnType<typeof eventDestination>>;
    subject: NonNullable<ReturnType<typeof workSubject>>;
  },
): Promise<WorkConversation> {
  const c = {
    ...skeleton(op, { ...p, linkId: `event-${home.id}` }, context),
    homeId: home.id,
    placementProjectId: subject.pageId,
    mode: 'selected' as const,
  };
  const card = markedCard(eventWorkCard({ title: String(p.title), pageId: subject.pageId }), op.id);
  await assertProvisionCurrent(db, op, context.clock, home);
  const created = await createOrRecover(
    db,
    providers,
    {
      op,
      p,
      d: target,
      card,
      title: String(p.title),
    },
    context.clock,
  );
  await checkpoint(db, op, { ...created }, context.clock);
  const ready = {
    ...c,
    ...created,
    activationId: created.starterMessageId,
    cursorId: created.starterMessageId,
    ...managedCreatedName(p, target.destination.kind, created.createdName),
  };
  if (!(await saveWorkConversation(db, ready, 0, context.clock())))
    throw new Error('conversation_already_linked');
  return ready;
}

async function provisionEvent(
  db: Db,
  providers: WorkProviders,
  input: { op: WorkOperation; p: Payload; actor: WorkActor },
  context: WorkEffectContext,
): Promise<WorkConversation> {
  const { op, p, actor } = input,
    subject = workSubject(p.subject),
    id = workString(p.linkId);
  if (subject?.kind !== 'event_plan' || !id) throw new Error('event_required');
  if (
    await hasOtherProjectHome(db, context.scope, {
      sourceId: subject.sourceId,
      projectId: subject.pageId,
      exceptId: id,
    })
  )
    throw new Error('project_already_linked');
  const previous = await readProjectHome(db, context.scope, id);
  if (
    previous &&
    (previous.kind !== 'event' ||
      previous.state !== 'active' ||
      previous.generation !== op.generation)
  )
    throw new Error('link_changed');
  const destination = await destinationFor(db, providers, { p, op }, context.clock);
  const target = await eventDestination(providers, p, destination);
  await assertProvisionCurrent(db, op, context.clock, previous ?? undefined);
  const home: ProjectHome = previous ?? {
    id,
    kind: 'event',
    scope: context.scope,
    projectSourceId: subject.sourceId,
    projectId: subject.pageId,
    taskSourceId: context.taskSourceId,
    destination: destination.destination,
    taskParent: null,
    audienceFingerprint: destination.audienceFingerprint,
    approvedBy: actor.personId,
    state: 'active',
    generation: 1,
    title: String(p.title),
  };
  if (!previous && !(await saveProjectHome(db, home, 0, context.clock())))
    throw new Error('project_already_linked');
  await db
    .prepare(
      "UPDATE discord_work_operations SET home_id=? WHERE id=? AND claim_token=? AND state='processing'",
    )
    .bind(id, op.id, op.claim_token)
    .run();
  op.home_id = id;
  const existing = await findWorkSubject(db, context.scope, subject);
  if (existing) return existing;
  return createEventConversation(db, providers, context, { op, p, home, target, subject });
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
  await refreshProvisionRoute(db, providers, op, { context, p, subject });
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject,
      discordUserId: op.actor_discord_id,
      action: p.intent === 'home' || p.intent === 'event' ? 'manage_home' : 'place_work',
      taskSourceId: context.taskSourceId,
      homeId: op.home_id ?? undefined,
    },
    context.clock(),
  );
  if (actor?.personId !== op.actor_person_id || actor.grantVersion !== op.grant_version)
    throw new Error('authority_changed');
  return p.intent === 'home'
    ? provisionHome(db, providers, { op, p, actor }, context)
    : p.intent === 'event'
      ? provisionEvent(db, providers, { op, p, actor }, context)
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
    await queueProjectPins(db, c, op, context);
    const confirmed = await settleWorkOperation(
      db,
      { id: op.id, token: op.claim_token },
      { state: 'confirmed', providerIds: { conversationId: c.id } },
      context.clock(),
    );
    return confirmed ? { kind: 'progress' } : { kind: 'paused', reason: 'unconfirmed_effect' };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'not_eligible' &&
      (op.home_id || op.result_json)
    ) {
      await settleWorkOperation(
        db,
        { id: op.id, token: op.claim_token },
        { state: 'held', reason: 'eligibility_changed_after_effect' },
        context.clock(),
      );
      return { kind: 'paused', reason: 'eligibility_changed_after_effect' };
    }
    if (error instanceof IneligibleWorkPage) {
      const now = context.clock().toISOString();
      const result = await db
        .prepare(
          "UPDATE discord_work_operations SET state='superseded',reason='not_eligible',payload_json=json_set(payload_json,'$.ineligibleEditedAt',?),claim_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND scope_key=? AND state='processing' AND claim_token=? AND lease_expires_at>?",
        )
        .bind(error.editedAt, now, op.id, op.scope_key, op.claim_token, now)
        .run();
      return { kind: 'paused', reason: result.meta.changes ? 'not_eligible' : 'link_changed' };
    }
    const outcome = workFailure(error);
    await settleWorkOperation(db, { id: op.id, token: op.claim_token }, outcome, context.clock());
    return { kind: 'paused', reason: outcome.reason };
  }
}
