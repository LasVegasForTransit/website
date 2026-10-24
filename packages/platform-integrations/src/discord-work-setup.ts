import { linkHome } from './discord-work-setup-links';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  listProjectHomes,
  listWorkConversations,
  readProjectHome,
  readWorkConversation,
  unlinkWork,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  enqueueWorkOperation,
  consumeWorkPreview,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { authorizeWork, resolveWorkActor } from './discord-work-authority';
import { workSubject, workString, notionWorkUrl } from './discord-work-input';
import { notionObject } from './notion-task-types';
import { taskMarkdown } from './notion-task-cards';
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
    p.intent === 'home' ? 'manage_home' : p.intent === 'comment' ? 'comment' : 'place_work';
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
async function show(
  db: Db,
  _providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const homes = await listProjectHomes(db, context.scope),
    conversations = await listWorkConversations(db, context.scope);
  const here = conversations.filter((c) => c.threadId === input.channelId),
    homeIds = new Set(here.map((c) => c.homeId));
  const relevant = homes.filter(
    (h) => h.destination.channelId === input.channelId || homeIds.has(h.id),
  );
  const lines = relevant.map(
    (h) =>
      `**${taskMarkdown(h.title ?? 'Project')}** · ${h.state === 'active' ? 'Linked' : 'Paused'}\nhttps://discord.com/channels/${context.scope.guildId}/${h.destination.channelId}`,
  );
  for (const c of here)
    lines.push(
      `${c.mode === 'automatic' ? t('discordWork.automatic') : t('discordWork.selected')}\n${c.reason ? 'Sync needs attention. Check account access and channel permissions; an administrator can unlink and relink to approve a changed audience.' : 'Sync is ready.'}`,
    );
  const row = await db
    .prepare(
      "SELECT state,reason,updated_at FROM discord_work_operations WHERE scope_key=? AND actor_person_id=? AND state IN ('held','failed') AND (home_id IN (SELECT value FROM json_each(?)) OR json_extract(payload_json,'$.destinationId')=?) ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(
      JSON.stringify([context.scope.environment, context.scope.guildId, context.scope.workspaceId]),
      (await resolveWorkActor(db, context.scope, input.discordUserId))?.personId ?? '',
      JSON.stringify(relevant.map((h) => h.id)),
      input.channelId,
    )
    .first<{ state: string; reason: string; updated_at: string }>();
  if (!relevant.length && !row) return setupReply(t('discordWork.none'));
  if (row)
    lines.push(
      row.state === 'held'
        ? 'An update is waiting for confirmation. It will not be sent again unless the original result can be verified.'
        : 'An update could not be completed. Check access before trying again.',
    );
  return setupReply(
    lines.join('\n\n') + (!context.enabled ? `\n\n${t('discordWork.disabled')}` : ''),
  );
}
async function unlink(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const pageId = notionWorkUrl(input.intent.url);
  const local = (await listWorkConversations(db, context.scope)).filter(
    (v) => v.threadId === input.channelId,
  );
  const overviewHomeIds = new Set(
    local.filter((v) => v.subject.kind === 'project_plan').map((v) => v.homeId),
  );
  const candidates = local.filter(
    (v) =>
      v.threadId === input.channelId &&
      v.subject.kind === 'task' &&
      (!pageId || v.subject.pageId === pageId),
  );
  if (candidates.length > 1)
    return setupReply(
      'Several tasks share this discussion. Use /work unlink url: with the Notion task URL.',
    );
  const [c] = candidates;
  const home = c
    ? await readProjectHome(db, context.scope, c.homeId)
    : (await listProjectHomes(db, context.scope)).find(
        (h) =>
          (h.destination.channelId === input.channelId || overviewHomeIds.has(h.id)) &&
          (!pageId || h.projectId === pageId),
      );
  if (!home) return setupReply(t('discordWork.noHome'));
  const subject = c?.subject ?? {
    kind: 'project_plan' as const,
    sourceId: home.projectSourceId,
    pageId: home.projectId,
  };
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject,
      taskSourceId: context.taskSourceId,
      discordUserId: input.discordUserId,
      action: c ? 'place_work' : 'manage_home',
    },
    context.clock(),
  );
  if (!actor && !(await resolveWorkActor(db, context.scope, input.discordUserId))?.administrator)
    return setupReply(t('discordWork.unavailable'));
  await unlinkWork(
    db,
    { scope: context.scope, id: c?.id ?? home.id, generation: c?.generation ?? home.generation },
    context.clock(),
  );
  return setupReply(t('discordWork.unlinked'));
}
type Handler = (
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
) => Promise<WorkPreviewResult>;
const handlers: Record<string, Handler> = {
  link: linkHome,
  show,
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
