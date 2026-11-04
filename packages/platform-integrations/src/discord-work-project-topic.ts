import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { readProjectHome } from '@lasvegasfortransit/platform-storage/discord-work-links';
import { workScopeKey } from '@lasvegasfortransit/platform-storage/discord-work-types';
import {
  consumeWorkPreview,
  enqueueWorkOperation,
  settleWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { authorizeWork, resolveWorkActor } from './discord-work-authority';
import { sameNotionWorkId, workSubject } from './discord-work-input';
import { notionObject } from './notion-task-types';
import { taskMarkdown } from './notion-task-cards';
import { setupReply, setupReceipt, ownedReceipt } from './discord-work-setup-common';
import { workMessage, workText, workButton, workCustomId } from './discord-work-cards';
import { workFailure, type WorkProviders, type WorkEffectContext } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';
import type { WorkOperation, WorkResult } from './discord-work-types';

function topicReceiptMatches(
  receipt: Awaited<ReturnType<typeof ownedReceipt>>,
  actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>,
): receipt is NonNullable<Awaited<ReturnType<typeof ownedReceipt>>> {
  return (
    receipt?.actor_person_id === actor.personId && receipt.grant_version === actor.grantVersion
  );
}

function topicPreviewConsumed(
  receipt: NonNullable<Awaited<ReturnType<typeof ownedReceipt>>>,
): boolean {
  return receipt.state === 'superseded' && receipt.reason === 'preview_consumed';
}

async function confirmProjectTopic(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    actor,
    input,
  }: { actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>; input: WorkPreviewInput },
): Promise<WorkPreviewResult> {
  const receipt = await ownedReceipt(db, input, context);
  if (!topicReceiptMatches(receipt, actor))
    return setupReply('This review has expired. Start again.');
  if (topicPreviewConsumed(receipt)) return setupReply('Topic update already queued.');
  const p = notionObject(JSON.parse(receipt.payload_json) as unknown);
  const subject = workSubject(p.subject);
  const home =
    typeof p.homeId === 'string' ? await readProjectHome(db, context.scope, p.homeId) : null;
  if (
    receipt.state !== 'preview' ||
    p.intent !== 'project-topic' ||
    !subject ||
    home?.state !== 'active' ||
    home.generation !== p.generation ||
    home.destination.channelId !== p.forumId
  )
    return setupReply('This project changed. Start again.');
  const authorized = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject,
      taskSourceId: context.taskSourceId,
      homeId: home.id,
      discordUserId: input.discordUserId,
      action: 'manage_home',
    },
    context.clock(),
  );
  if (authorized?.personId !== actor.personId || authorized.grantVersion !== actor.grantVersion)
    return setupReply('Project access changed. Start again.');
  const result = await enqueueWorkOperation(
    db,
    {
      id: `topic-${receipt.id}`,
      scope: context.scope,
      homeId: home.id,
      conversationId: null,
      generation: home.generation,
      kind: 'provision',
      sourceKey: `topic:${receipt.id}`,
      actorPersonId: actor.personId,
      actorDiscordId: actor.discordUserId,
      grantVersion: actor.grantVersion,
      originalAuthorId: actor.discordUserId,
      payload: p,
    },
    context.clock(),
  );
  if (result === 'stale') return setupReply('The topic update could not be queued.');
  await consumeWorkPreview(
    db,
    { scope: context.scope, id: receipt.id, actorId: input.discordUserId },
    context.clock(),
  );
  return setupReply('Topic update queued. Use /work show to check its status.');
}

function projectTopicCard(
  forumId: string,
  previous: string | null,
  next: string,
  receiptId: string,
): WorkPreviewResult {
  const current =
    previous === null || previous === '' ? '(empty)' : taskMarkdown(previous.slice(0, 1000));
  return {
    kind: 'ready',
    card: workMessage([
      workText(
        `### Replace forum topic\nForum: <#${forumId}>\nCurrent topic: ${current}${previous && previous.length > 1000 ? '\nThe current topic is longer; inspect the forum before confirming.' : ''}\nNew topic: ${next}\nDiscord cannot guarantee an edit made during the update is preserved.`,
      ),
      {
        type: 1,
        components: [
          workButton(
            workCustomId({ id: receiptId, generation: 1 }, 'topic-confirm'),
            'Replace topic',
          ),
        ],
      },
    ]),
  };
}

async function previewProjectTopic(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    actor,
    input,
  }: { actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>; input: WorkPreviewInput },
): Promise<WorkPreviewResult> {
  const forumId = input.intent.destinationId;
  if (!forumId) return setupReply('Choose an existing project forum.');
  const rows = await db
    .prepare(
      "SELECT id FROM discord_project_homes WHERE scope_key=? AND destination_id=? AND state='active' AND coalesce(json_extract(data_json,'$.kind'),'project')='project' LIMIT 2",
    )
    .bind(workScopeKey(context.scope), forumId)
    .all<{ id: string }>();
  const [row] = rows.results;
  if (rows.results.length !== 1 || !row)
    return setupReply('This forum is not linked to exactly one active project.');
  const home = await readProjectHome(db, context.scope, row.id);
  if (home?.destination.kind !== 'forum') return setupReply('The project forum is unavailable.');
  const subject = {
    kind: 'project_plan' as const,
    sourceId: home.projectSourceId,
    pageId: home.projectId,
  };
  const authorized = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject,
      taskSourceId: context.taskSourceId,
      homeId: home.id,
      discordUserId: input.discordUserId,
      action: 'manage_home',
    },
    context.clock(),
  );
  const forum = await providers.discord.inspectDestination(forumId);
  if (
    !authorized ||
    forum.destination.kind !== 'forum' ||
    forum.destination.parentId !== home.destination.parentId ||
    !forum.canRead ||
    !forum.canManageChannels ||
    forum.audienceFingerprint !== home.audienceFingerprint
  )
    return setupReply('The project forum, audience or Manage Channels permission is unavailable.');
  const previous = await providers.discord.readForumTopic(forumId);
  const next = `Project plan: https://www.notion.so/${home.projectId.replaceAll('-', '')}`;
  if (previous === next) return setupReply('The forum topic already links to this project.');
  const receipt = await setupReceipt(
    db,
    {
      request: input,
      actor,
      payload: {
        intent: 'project-topic',
        subject,
        homeId: home.id,
        generation: home.generation,
        forumId,
        audienceFingerprint: home.audienceFingerprint,
        expectedTopic: previous,
        topic: next,
      },
    },
    context,
  );
  return projectTopicCard(forumId, previous, next, receipt.id);
}

export async function projectTopicSetup(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const actor = await resolveWorkActor(db, context.scope, input.discordUserId);
  if (!actor?.administrator) return setupReply('Administrator access is required.');
  if (!context.enabled) return setupReply('Project linking is disabled.');
  if (input.intent.action === 'topic-confirm')
    return confirmProjectTopic(db, providers, context, { actor, input });
  return previewProjectTopic(db, providers, context, { actor, input });
}

async function loadTopicWork(db: Db, op: WorkOperation, context: WorkEffectContext) {
  const p = notionObject(JSON.parse(op.payload_json) as unknown);
  const subject = workSubject(p.subject);
  const home = op.home_id ? await readProjectHome(db, context.scope, op.home_id) : null;
  if (
    p.intent !== 'project-topic' ||
    subject?.kind !== 'project_plan' ||
    home?.state !== 'active' ||
    home.generation !== op.generation ||
    home.destination.kind !== 'forum' ||
    home.destination.channelId !== p.forumId ||
    !sameNotionWorkId(home.projectId, subject.pageId) ||
    !sameNotionWorkId(home.projectSourceId, subject.sourceId) ||
    (p.expectedTopic !== null && typeof p.expectedTopic !== 'string') ||
    typeof p.topic !== 'string'
  )
    throw new Error('link_changed');
  return { p, subject, home, expectedTopic: p.expectedTopic, topic: p.topic };
}

export async function processWorkTopic(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  if (!context.enabled || op.state !== 'processing') return { kind: 'idle' };
  try {
    const { p, subject, home, expectedTopic, topic } = await loadTopicWork(db, op, context);
    const actor = await authorizeWork(
      db,
      providers,
      {
        scope: context.scope,
        subject,
        taskSourceId: context.taskSourceId,
        homeId: home.id,
        discordUserId: op.actor_discord_id,
        action: 'manage_home',
      },
      context.clock(),
    );
    if (actor?.personId !== op.actor_person_id || actor.grantVersion !== op.grant_version)
      throw new Error('authority_changed');
    const forum = await providers.discord.inspectDestination(home.destination.channelId);
    if (
      forum.destination.kind !== 'forum' ||
      forum.destination.parentId !== home.destination.parentId ||
      !forum.canRead ||
      !forum.canManageChannels ||
      forum.audienceFingerprint !== home.audienceFingerprint ||
      forum.audienceFingerprint !== p.audienceFingerprint
    )
      throw new Error('audience_changed');
    const active = await db
      .prepare(
        "SELECT 1 FROM discord_work_operations o JOIN discord_project_homes h ON h.id=o.home_id AND h.scope_key=o.scope_key WHERE o.id=? AND o.scope_key=? AND o.claim_token=? AND o.state='processing' AND o.lease_expires_at>? AND h.state='active' AND h.generation=?",
      )
      .bind(op.id, op.scope_key, op.claim_token, context.clock().toISOString(), op.generation)
      .first();
    if (!active) throw new Error('link_changed');
    await providers.discord.updateForumTopic({
      forumId: home.destination.channelId,
      expectedTopic,
      topic,
    });
    const saved = await settleWorkOperation(
      db,
      { id: op.id, token: op.claim_token },
      { state: 'confirmed' },
      context.clock(),
    );
    return saved ? { kind: 'progress' } : { kind: 'paused', reason: 'unconfirmed_effect' };
  } catch (error) {
    const outcome = workFailure(error);
    await settleWorkOperation(db, { id: op.id, token: op.claim_token }, outcome, context.clock());
    return { kind: 'paused', reason: outcome.reason };
  }
}
