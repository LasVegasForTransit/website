import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readProjectHome,
  readWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { enqueueWorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { authorizeWork } from './discord-work-authority';
import { taskStatus } from './notion-task-status';
import { setupReply } from './discord-work-setup-common';
import type { WorkProviders, WorkEffectContext } from './discord-work-actions';
import type { WorkConversation } from './discord-work-types';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';
function validValue(input: WorkPreviewInput) {
  if (input.intent.action === 'status') return Boolean(taskStatus(input.intent.value));
  const text = input.intent.text;
  return typeof text === 'string' && text.trim().length > 0 && text.length <= 1800;
}
async function controlChannel(db: Db, c: WorkConversation) {
  const home = await readProjectHome(db, c.scope, c.homeId);
  return (
    c.cardChannelId ?? (home?.destination.kind === 'text' ? home.destination.channelId : c.threadId)
  );
}
export async function queueSharedControl(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  if (!context.enabled) return setupReply(t('discordWork.disabled'));
  const c = await readWorkConversation(db, context.scope, input.intent.linkId ?? '');
  if (
    c?.state !== 'active' ||
    c.generation !== input.intent.generation ||
    c.starterMessageId !== input.intent.messageId
  )
    return setupReply(t('discordWork.unavailable'));
  const channelId = await controlChannel(db, c);
  const status = input.intent.action === 'status';
  if (channelId !== input.channelId || !validValue(input))
    return setupReply(t('discordWork.unavailable'));
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject: c.subject,
      conversationId: c.id,
      generation: c.generation,
      taskSourceId: context.taskSourceId,
      discordUserId: input.discordUserId,
      action: status ? 'set_status' : 'comment',
    },
    context.clock(),
  );
  if (!actor) return setupReply(t('discordWork.unavailable'));
  await enqueueWorkOperation(
    db,
    {
      id: crypto.randomUUID(),
      scope: context.scope,
      homeId: c.homeId,
      conversationId: c.id,
      generation: c.generation,
      kind: status ? 'status' : 'comment',
      sourceKey: `interaction:${input.interactionId}`,
      actorPersonId: actor.personId,
      actorDiscordId: actor.discordUserId,
      grantVersion: actor.grantVersion,
      originalAuthorId: actor.discordUserId,
      payload: status
        ? { status: input.intent.value, taskSourceId: context.taskSourceId }
        : {
            text: input.intent.text,
            taskSourceId: context.taskSourceId,
            createdAt: context.clock().toISOString(),
            message: { id: c.starterMessageId, channelId, authorName: actor.displayName },
          },
    },
    context.clock(),
  );
  return setupReply(t('discordWork.queued'));
}
