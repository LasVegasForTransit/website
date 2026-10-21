import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readTaskCheckinSource,
  enqueueTaskDelivery,
  claimTaskOperation,
  completeTaskOperation,
  readTaskActionContext,
  type TaskOperation,
} from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import { ensureTaskCard } from '@lasvegasfortransit/platform-storage/notion-task-cards';
import { reserveTaskNotification } from '@lasvegasfortransit/platform-storage/notion-task-notifications';
import {
  listTaskReminderCandidates,
  noteTaskReminderEvaluation,
  confirmTaskDelivery,
  deferTaskDelivery,
  type TaskReminderCandidate,
} from '@lasvegasfortransit/platform-storage/notion-task-reminders';
import { readTaskCheckinPolicy } from './notion-task-policy';
import { selectTaskReminder, taskQuietNow, type ReminderHistory } from './notion-task-reminders';
import { notionObject, type NotionTaskSnapshot } from './notion-task-types';
import { renderTaskCard } from './notion-task-cards';
import { DiscordApiFailure } from './discord-types';
import type { DiscordTaskClient } from './notion-task-discord';
import { NotionTaskApiError, type NotionTaskClient } from './notion-task-client';
import { readCurrentNotionTask } from './notion-task-current';
function history(row: TaskReminderCandidate): ReminderHistory | undefined {
  if (!row.last_delivery_json) return undefined;
  const value = notionObject(JSON.parse(row.last_delivery_json) as unknown);
  if (
    typeof value.id === 'string' &&
    typeof value.at === 'string' &&
    typeof value.scheduledAt === 'string'
  )
    return { id: value.id, at: value.at, scheduledAt: value.scheduledAt };
  return undefined;
}

function selection(
  row: TaskReminderCandidate,
  policy: NonNullable<ReturnType<typeof readTaskCheckinPolicy>>,
  now: Date,
) {
  return selectTaskReminder({
    task: JSON.parse(row.snapshot_json) as NotionTaskSnapshot,
    policy,
    now,
    snoozedUntil: row.snoozed_until,
    lastDelivery: history(row),
    lastResponseAt: row.last_response_at,
  });
}
export async function queueTaskReminders(
  db: Db,
  sourceId: string,
  clock: () => Date,
): Promise<{ queued: number; configurationRequired: boolean }> {
  const source = await readTaskCheckinSource(db, sourceId);
  const policy = source && readTaskCheckinPolicy(source.policy_json);
  if (!source?.enabled || !policy)
    return { queued: 0, configurationRequired: Boolean(source?.enabled) };
  const policyKey = await digestToken(JSON.stringify(policy));
  let queued = 0;
  for (const row of await listTaskReminderCandidates(db, sourceId, 10, { policyKey })) {
    const owner = { sourceId, taskId: row.task_id, personId: row.person_id };
    if (!(await ensureTaskCard(db, owner, clock()))) continue;
    await noteTaskReminderEvaluation(db, owner, clock());
    const reminder = selection(row, policy, clock());
    if (!reminder) continue;
    const id = `task-reminder:${await digestToken(JSON.stringify([sourceId, row.task_id, row.person_id, row.task_revision, policyKey, reminder.slot]))}`;
    if (
      await enqueueTaskDelivery(
        db,
        {
          id,
          ...owner,
          taskRevision: row.task_revision,
          consentRevision: row.consent_revision,
          policyRevision: row.policy_revision,
          payload: { ...reminder, policyKey },
        },
        clock(),
      )
    )
      queued++;
  }
  return { queued, configurationRequired: false };
}
export function taskDeliveryFailure(error: unknown, attempts: number, effectStarted: boolean) {
  const rate = error instanceof DiscordApiFailure && error.kind === 'rate_limited';
  const denied =
    error instanceof DiscordApiFailure &&
    ['permission_denied', 'not_configured'].includes(error.kind);
  const uncertain = effectStarted && !rate && !denied;
  const retryAfterMs = Math.max(
    Math.min(3_600_000, 60_000 * 2 ** (attempts - 1)),
    error instanceof DiscordApiFailure
      ? (error.retryAfterMs ?? 0)
      : error instanceof NotionTaskApiError
        ? error.retryAfterMs
        : 0,
  );
  return {
    state: uncertain ? ('held' as const) : denied ? ('failed' as const) : ('retryable' as const),
    reason: uncertain
      ? 'unconfirmed_effect'
      : error instanceof DiscordApiFailure
        ? error.kind
        : 'provider_unavailable',
    retryAfterMs,
  };
}
async function deliveryReady(
  db: Db,
  operation: TaskOperation,
  clock: () => Date,
): Promise<boolean> {
  const lease = { id: operation.id, token: operation.claim_token };
  const context = await readTaskActionContext(db, operation, clock());
  const policy = context && readTaskCheckinPolicy(context.policy_json);
  if (!context || !policy) {
    await completeTaskOperation(
      db,
      lease,
      { state: 'superseded', reason: 'authority_changed' },
      clock(),
    );
    return false;
  }
  const row = (
    await listTaskReminderCandidates(db, operation.source_id, 1, {
      taskId: operation.task_id,
      personId: operation.person_id,
      policyKey: await digestToken(JSON.stringify(policy)),
    })
  )[0];
  if (taskQuietNow(policy, clock()) || Date.parse(row?.snoozed_until ?? '') > clock().getTime()) {
    await deferTaskDelivery(db, operation, clock());
    return false;
  }
  const reminder = row && selection(row, policy, clock());
  const payload = notionObject(JSON.parse(operation.payload_json) as unknown);
  if (!reminder || reminder.slot !== payload.slot) {
    await completeTaskOperation(
      db,
      lease,
      { state: 'superseded', reason: 'schedule_changed' },
      clock(),
    );
    return false;
  }
  return true;
}
async function reserveDelivery(db: Db, operation: TaskOperation, now: Date): Promise<boolean> {
  if (await reserveTaskNotification(db, { kind: 'delivery', operation }, now)) return true;
  await deferTaskDelivery(db, operation, now);
  return false;
}
export async function processTaskDelivery(
  db: Db,
  providers: { notion: NotionTaskClient; discord: DiscordTaskClient },
  id: string,
  clock: () => Date,
): Promise<void> {
  const { notion, discord } = providers;
  const operation = await claimTaskOperation(db, id, clock());
  if (!operation) return;
  const lease = { id, token: operation.claim_token };
  let effectStarted = false;
  try {
    if (!(await deliveryReady(db, operation, clock))) return;
    const current = await readCurrentNotionTask(db, notion, operation, {
      membership: (user, guild) => discord.membership(user, guild),
      clock,
    });
    if (!current) {
      await completeTaskOperation(
        db,
        lease,
        { state: 'superseded', reason: 'task_changed' },
        clock(),
      );
      return;
    }
    const card = await ensureTaskCard(
      db,
      { sourceId: operation.source_id, taskId: operation.task_id, personId: operation.person_id },
      clock(),
    );
    if (!card) return;
    const channelId = await discord.openDM(current.context.discord_user_id);
    const latest = await readTaskActionContext(db, operation, clock());
    if (latest?.discord_user_id !== current.context.discord_user_id) {
      await completeTaskOperation(
        db,
        lease,
        { state: 'superseded', reason: 'authority_changed' },
        clock(),
      );
      return;
    }
    if (!(await reserveDelivery(db, operation, clock()))) return;
    const message = renderTaskCard({
      token: card.token,
      task: current.task,
      policy: current.policy,
      active: true,
    });
    effectStarted = true;
    const sent = await discord.sendCard(channelId, current.context.discord_user_id, message, id);
    if (
      !(await confirmTaskDelivery(db, operation, { channelId, messageId: sent.messageId }, clock()))
    )
      await completeTaskOperation(
        db,
        lease,
        {
          state: 'held',
          reason: 'unconfirmed_effect',
          result: { channelId, messageId: sent.messageId },
        },
        clock(),
      );
  } catch (error) {
    await completeTaskOperation(
      db,
      lease,
      taskDeliveryFailure(error, operation.attempts, effectStarted),
      clock(),
    );
  }
}
