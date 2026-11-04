import { adoptProject } from './discord-work-adopt-project';
import { adoptEvent } from './discord-work-adopt-event';
import { projectEventTags } from './discord-work-project-tags';
import { projectTopicSetup } from './discord-work-project-topic';
import { tagMappingSetup } from './discord-work-tag-setup';
import { linkHome } from './discord-work-setup-links';
import { routeSetup } from './discord-work-route-setup';
import { manageWorkRoute } from './discord-work-route-manage';
import { destinationSetup } from './discord-work-destination-setup';
import { show, unlink } from './discord-work-link-controls';
import { enableNameSync } from './discord-work-name-opt-in';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readProjectHome,
  readWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  enqueueWorkOperation,
  consumeWorkPreview,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { authorizeWork, resolveWorkActor } from './discord-work-authority';
import { workSubject, workString } from './discord-work-input';
import { notionObject } from './notion-task-types';
import { setupReply, ownedReceipt, receiptCard } from './discord-work-setup-common';
import {
  workTaskPicker,
  workTaskSelection,
  workSaveMessage,
  workSaveSelection,
  workSaveProject,
} from './discord-work-setup-tasks';
import { queueSharedControl } from './discord-work-controls';
import type { WorkProviders, WorkEffectContext } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';
async function currentReceiptActor(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
) {
  const receipt = await ownedReceipt(db, input, context);
  if (!receipt) return null;
  const p = notionObject(JSON.parse(receipt.payload_json) as unknown),
    subject = workSubject(p.subject);
  if (!subject) return null;
  const action =
    p.intent === 'home' || p.intent === 'event'
      ? 'manage_home'
      : p.intent === 'comment'
        ? 'comment'
        : 'place_work';
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject,
      homeId: workString(p.homeId) ?? undefined,
      taskSourceId: context.taskSourceId,
      discordUserId: input.discordUserId,
      action,
    },
    context.clock(),
  );
  if (actor?.personId !== receipt.actor_person_id || actor.grantVersion !== receipt.grant_version)
    return null;
  return { receipt, p, actor, subject };
}
async function queueReceipt(
  db: Db,
  current: Pick<
    NonNullable<Awaited<ReturnType<typeof currentReceiptActor>>>,
    'receipt' | 'p' | 'actor'
  >,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const { receipt, p, actor } = current;
  const homeId = workString(p.homeId),
    home = homeId ? await readProjectHome(db, context.scope, homeId) : null;
  const conversationId = workString(p.conversationId);
  const conversation = conversationId
    ? await readWorkConversation(db, context.scope, conversationId)
    : null;
  const sourceKey = typeof p.sourceKey === 'string' ? p.sourceKey : `setup:${receipt.id}`;
  const result = await enqueueWorkOperation(
    db,
    {
      id: `effect-${receipt.id}`,
      scope: context.scope,
      homeId: home?.id ?? null,
      conversationId: workString(p.conversationId),
      generation: conversation?.generation ?? home?.generation ?? 1,
      kind: p.intent === 'comment' ? 'comment' : 'provision',
      sourceKey,
      actorPersonId: actor.personId,
      actorDiscordId: actor.discordUserId,
      grantVersion: actor.grantVersion,
      originalAuthorId:
        typeof p.originalAuthorId === 'string' ? p.originalAuthorId : actor.discordUserId,
      payload: p,
    },
    context.clock(),
  );
  if (result === 'stale') return setupReply(t('discordWork.unavailable'));
  await consumeWorkPreview(
    db,
    { scope: context.scope, id: receipt.id, actorId: actor.discordUserId },
    context.clock(),
  );
  return setupReply(t('discordWork.queued'));
}
async function confirm(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  if (!context.enabled) return setupReply(t('discordWork.disabled'));
  const current = await currentReceiptActor(db, providers, input, context);
  if (!current) return setupReply(t('discordWork.unavailable'));
  const { receipt, p, actor } = current;
  if (receipt.reason === 'preview_consumed') return setupReply(t('discordWork.queued'));
  if (p.requiredTag === true && (!Array.isArray(p.tagIds) || !p.tagIds.length))
    return receiptCard(receipt, context);
  return queueReceipt(db, { receipt, p, actor }, context);
}
async function tag(
  db: Db,
  _providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const receipt = await ownedReceipt(db, input, context);
  if (receipt?.state !== 'preview') return setupReply(t('discordWork.unavailable'));
  const p = notionObject(JSON.parse(receipt.payload_json) as unknown),
    tags = Array.isArray(p.availableTags) ? p.availableTags : [];
  if (!tags.some((v) => notionObject(v).id === input.intent.value))
    return setupReply(t('discordWork.unavailable'));
  receipt.payload_json = JSON.stringify({ ...p, tagIds: [input.intent.value] });
  await db
    .prepare(
      "UPDATE discord_work_operations SET payload_json=? WHERE id=? AND state='preview' AND actor_discord_id=?",
    )
    .bind(receipt.payload_json, receipt.id, input.discordUserId)
    .run();
  return receiptCard(receipt, context);
}
type Handler = (
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
) => Promise<WorkPreviewResult>;
const handlers: Record<string, Handler> = {
  'create-event-forum': destinationSetup,
  'create-event-channel': destinationSetup,
  'create-category': destinationSetup,
  'dest-confirm': destinationSetup,
  destinations: destinationSetup,
  'adopt-project': adoptProject,
  'adopt-event': adoptEvent,
  'project-event-tags': projectEventTags,
  'project-topic': projectTopicSetup,
  'topic-confirm': projectTopicSetup,
  'route-tags-start': tagMappingSetup,
  'route-tags-forum': tagMappingSetup,
  'route-tags-field': tagMappingSetup,
  'route-tags-value': tagMappingSetup,
  'route-tags-save': tagMappingSetup,
  'project-tag-save': projectEventTags,
  'project-tag-clear': projectEventTags,
  'route-project': routeSetup,
  routes: routeSetup,
  'routes-more': routeSetup,
  'route-manage': manageWorkRoute,
  'route-prepare': manageWorkRoute,
  'route-enable': manageWorkRoute,
  'route-enable-confirm': manageWorkRoute,
  'route-pause': manageWorkRoute,
  'route-retry-checks': manageWorkRoute,
  'route-create-event': manageWorkRoute,
  'route-edit': routeSetup,
  'route-dest': routeSetup,
  'route-event': routeSetup,
  'route-event-project': routeSetup,
  'route-relation': routeSetup,
  'route-source': routeSetup,
  'route-more': routeSetup,
  'route-next': routeSetup,
  'route-choice': routeSetup,
  'route-tag': routeSetup,
  'route-skip-tag': routeSetup,
  'route-approve': routeSetup,
  link: linkHome,
  show,
  'sync-name': enableNameSync,
  'resolve-name': enableNameSync,
  unlink,
  confirm,
  tag,
  tasks: workTaskPicker,
  task: workTaskSelection,
  'tasks-more': workTaskPicker,
  'save-message': workSaveMessage,
  'save-target': workSaveSelection,
  'save-project': workSaveProject,
  status: queueSharedControl,
  'note-submit': queueSharedControl,
};
export async function runWorkPreview(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  if (input.guildId !== context.scope.guildId)
    return { kind: 'unavailable', reason: 'wrong_guild' };
  if (
    !(await resolveWorkActor(db, context.scope, input.discordUserId)) ||
    !(await providers.discord.membership(input.discordUserId, input.guildId))
  )
    return setupReply(t('discordWork.unavailable'));
  const handler = handlers[input.intent.action];
  if (!handler) return setupReply(t('discordWork.unavailable'));
  return handler(db, providers, input, context);
}
