import { taskStatusSelection } from './notion-task-status';
import { t } from '@lasvegasfortransit/platform-core/messages';
import type { TaskCardContext } from '@lasvegasfortransit/platform-storage/notion-task-cards';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readTaskCard,
  readTaskInteractionReceipt,
} from '@lasvegasfortransit/platform-storage/notion-task-cards';
import {
  recordTaskInteraction,
  type TaskOperationInput,
} from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import type { TaskCheckinSource } from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import {
  renderTaskSetup,
  renderTaskUpdateMenu,
  taskUpdateAction,
  renderTaskModal,
  renderTaskCompletion,
  taskModalText,
  type TaskCustomId,
  type TaskCardAction,
} from './notion-task-cards';
import { taskJson, taskNotice, taskPrivateMessage } from './notion-task-replies';
import { notionObject } from './notion-task-types';
import type { TaskCheckinPolicy } from './notion-task-policy';

function actionAllowed(action: TaskCardAction, policy: TaskCheckinPolicy): boolean {
  if (action === 'confirm' || action === 'status') return policy.actions.complete;
  if (
    action === 'progress' ||
    action === 'blocker' ||
    action === 'complete' ||
    action === 'extension'
  )
    return policy.actions[action];
  return true;
}
function operationRequest(
  interaction: Record<string, unknown>,
  action: TaskCardAction,
): {
  kind: TaskOperationInput['kind'];
  payload: Record<string, unknown>;
} | null {
  if (interaction.type === 3 && action === 'status') {
    const status = taskStatusSelection(interaction.data);
    return status ? { kind: 'complete', payload: { status } } : null;
  }
  if (interaction.type === 3 && action === 'confirm') return { kind: 'complete', payload: {} };
  if (interaction.type === 3 && action === 'snooze') return { kind: 'snooze', payload: {} };
  if (interaction.type !== 5 || !['progress', 'blocker', 'extension'].includes(action)) return null;
  const text = taskModalText(interaction.data);
  return text ? { kind: action as 'progress' | 'blocker' | 'extension', payload: { text } } : null;
}
type ActionRequest = NonNullable<ReturnType<typeof operationRequest>>;
function privateCardScope(
  interaction: Record<string, unknown>,
  card: TaskCardContext,
  sourceId: string,
): boolean {
  if (interaction.guild_id !== undefined && interaction.guild_id !== null) return false;
  if (card.source_id !== sourceId || !card.channel_id || interaction.channel_id !== card.channel_id)
    return false;
  return interaction.type !== 3 || typeof notionObject(interaction.message).id === 'string';
}
function messageMatches(
  interaction: Record<string, unknown>,
  card: TaskCardContext,
  action: TaskCardAction,
): boolean {
  if (interaction.type !== 3) return true;
  const message = notionObject(interaction.message);
  if (action === 'confirm' || action === 'cancel' || action === 'update')
    return (
      message.id !== card.message_id &&
      typeof message.flags === 'number' &&
      (message.flags & 64) === 64
    );
  return message.id === card.message_id;
}
function immediateReply(
  action: TaskCardAction,
  token: string,
  policy: TaskCheckinPolicy,
): Response | null {
  if (action === 'menu') return taskPrivateMessage(renderTaskUpdateMenu(token, policy));
  if (action === 'progress' || action === 'blocker' || action === 'extension')
    return taskJson(renderTaskModal(token, action));
  if (action === 'complete') return taskPrivateMessage(renderTaskCompletion(token));
  return action === 'cancel' ? taskNotice(t('taskCheckins.cancelled')) : null;
}
async function recordResponse(
  db: Db,
  input: { card: TaskCardContext; interactionId: string; request: ActionRequest },
  now: Date,
): Promise<Response> {
  const { card, interactionId, request } = input;
  const recorded = await recordTaskInteraction(
    db,
    {
      id: interactionId,
      sourceId: card.source_id,
      taskId: card.task_id,
      personId: card.person_id,
      taskRevision: card.task_revision,
      consentRevision: card.consent_revision,
      policyRevision: card.policy_revision,
      ...request,
    },
    now,
  );
  if (!recorded) {
    const receipt = await readTaskInteractionReceipt(db, {
      id: interactionId,
      sourceId: card.source_id,
      taskId: card.task_id,
      personId: card.person_id,
    });
    if (receipt?.kind !== request.kind || receipt.payload_json !== JSON.stringify(request.payload))
      return taskNotice(t('taskCheckins.retryLater'), 409);
    if (receipt.state === 'confirmed')
      return taskNotice(
        request.kind === 'snooze' ? t('taskCheckins.snoozed') : t('taskCheckins.saved'),
      );
    if (['held', 'failed', 'superseded'].includes(receipt.state))
      return taskNotice(t('taskCheckins.notSaved'));
  }
  return taskNotice(
    request.kind === 'snooze' ? t('taskCheckins.pendingSnooze') : t('taskCheckins.pending'),
  );
}
export async function handleTaskCardAction(
  db: Db,
  input: {
    interaction: Record<string, unknown>;
    custom: Extract<TaskCustomId, { kind: 'task' }>;
    policy: TaskCheckinPolicy;
    source: TaskCheckinSource;
    discordUserId: string;
  },
  now: Date,
): Promise<Response> {
  const { interaction, custom, policy, source, discordUserId } = input;
  const card = await readTaskCard(db, { token: custom.token, discordUserId });
  if (!card) return new Response(null, { status: 403 });
  if (!privateCardScope(interaction, card, source.id)) return new Response(null, { status: 403 });
  if (card.retired) return taskNotice(t('taskCheckins.stale'));
  if (!messageMatches(interaction, card, custom.action)) return taskNotice(t('taskCheckins.stale'));
  if (custom.action === 'preferences')
    return taskPrivateMessage(
      renderTaskSetup({ sourceId: source.id, revision: source.revision, policy }),
    );
  if (!card.actionable || card.policy_revision !== source.revision)
    return taskNotice(t('taskCheckins.stale'));
  const action = custom.action === 'update' ? taskUpdateAction(interaction.data) : custom.action;
  if (!action) return new Response(null, { status: 400 });
  if (!actionAllowed(action, policy)) return new Response(null, { status: 403 });
  const immediate = interaction.type === 3 ? immediateReply(action, custom.token, policy) : null;
  if (immediate) return immediate;
  const request = operationRequest(interaction, action);
  if (!request || typeof interaction.id !== 'string') return new Response(null, { status: 400 });
  return recordResponse(db, { card, interactionId: interaction.id, request }, now);
}
