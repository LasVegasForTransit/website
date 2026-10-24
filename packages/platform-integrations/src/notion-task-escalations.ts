import { t } from '@lasvegasfortransit/platform-core/messages';
import { taskProviderCoolingDown } from '@lasvegasfortransit/platform-storage/notion-task-provider-backoff';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  claimTaskEscalation,
  readTaskEscalationContext,
  settleTaskEscalation,
  type TaskEscalation,
} from '@lasvegasfortransit/platform-storage/notion-task-escalations';
import { reserveTaskNotification } from '@lasvegasfortransit/platform-storage/notion-task-notifications';
import type { NotionTaskClient } from './notion-task-client';
import type { DiscordTaskClient } from './notion-task-discord';
import { readCurrentEscalation } from './notion-task-escalation-current';
import { taskQuietNow } from './notion-task-reminders';
import { readTaskCheckinPolicy } from './notion-task-policy';
import { taskDeliveryFailure } from './notion-task-delivery';
import { taskMarkdown, taskNotionLink, type DiscordTaskMessage } from './notion-task-cards';
export { queueTaskEscalations } from './notion-task-escalation-queue';
function render(
  current: NonNullable<Awaited<ReturnType<typeof readCurrentEscalation>>> & { kind: 'ready' },
  claim: TaskEscalation,
): DiscordTaskMessage {
  const name = taskMarkdown(
    (current.context.subject_name ?? t('taskCheckins.escalationAnonymous')).slice(0, 100),
  );
  const heading =
    claim.trigger_kind === 'blocker'
      ? t('taskCheckins.escalationBlocker', { name })
      : t('taskCheckins.escalationOverdue', { name });
  return {
    flags: 32768,
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 17,
        components: [
          {
            type: 10,
            content: `### ${heading}`,
          },
          {
            type: 9,
            components: [
              {
                type: 10,
                content: `**${taskMarkdown(current.task.title.slice(0, 120))}**\n${taskMarkdown(current.task.status.slice(0, 60))}`,
              },
            ],
            accessory: {
              type: 2,
              style: 5,
              label: t('taskCheckins.openNotion'),
              url: taskNotionLink(current.task.url),
            },
          },
          ...(claim.trigger_kind === 'blocker' && current.context.blocker_text
            ? [{ type: 10, content: taskMarkdown(current.context.blocker_text.slice(0, 1000)) }]
            : []),
          { type: 10, content: t('taskCheckins.escalationPreferences') },
        ],
      },
    ],
  };
}
async function prepare(
  db: Db,
  providers: { notion: NotionTaskClient; discord: DiscordTaskClient },
  claim: TaskEscalation,
  clock: () => Date,
) {
  const context = await readTaskEscalationContext(db, claim, clock()),
    policy = context && readTaskCheckinPolicy(context.policy_json);
  if (!context || !policy) return null;
  if (
    taskQuietNow(policy, clock()) ||
    (claim.trigger_kind === 'overdue' &&
      Date.parse(context.snoozed_until ?? '') > clock().getTime())
  ) {
    await settleTaskEscalation(
      db,
      claim,
      { state: 'deferred', reason: 'quiet_or_snoozed' },
      clock(),
    );
    return null;
  }
  if (
    !(await providers.discord.membership(context.discord_user_id, policy.guildId)) ||
    !(await providers.discord.membership(context.subject_discord_user_id, policy.guildId))
  )
    return null;
  const channelId = await providers.discord.openDM(context.discord_user_id);
  const current = await readCurrentEscalation(db, providers.notion, claim, clock);
  if (!current) return null;
  if (current.kind === 'review') {
    await settleTaskEscalation(db, claim, { state: 'review', reason: current.reason }, clock());
    return null;
  }
  return { channelId, userId: current.context.discord_user_id, card: render(current, claim) };
}
export async function processTaskEscalation(
  db: Db,
  providers: { notion: NotionTaskClient; discord: DiscordTaskClient },
  sourceId: string,
  clock: () => Date,
): Promise<{ kind: 'idle' | 'progress' }> {
  if (await taskProviderCoolingDown(db, sourceId, clock())) return { kind: 'idle' };
  const claim = await claimTaskEscalation(db, sourceId, clock());
  if (!claim) return { kind: 'idle' };
  let effectStarted = false;
  try {
    const prepared = await prepare(db, providers, claim, clock);
    if (!prepared) {
      await settleTaskEscalation(
        db,
        claim,
        { state: 'superseded', reason: 'authority_or_task_changed' },
        clock(),
      );
      return { kind: 'progress' };
    }
    if (!(await reserveTaskNotification(db, { kind: 'escalation', operation: claim }, clock()))) {
      await settleTaskEscalation(
        db,
        claim,
        { state: 'deferred', reason: 'notification_limit' },
        clock(),
      );
      return { kind: 'progress' };
    }
    effectStarted = true;
    const sent = await providers.discord.sendCard(
      prepared.channelId,
      prepared.userId,
      prepared.card,
      claim.id,
    );
    const result = { channelId: prepared.channelId, messageId: sent.messageId };
    if (!(await settleTaskEscalation(db, claim, { state: 'confirmed', result }, clock())))
      await settleTaskEscalation(
        db,
        claim,
        { state: 'held', reason: 'unconfirmed_effect', result },
        clock(),
      );
  } catch (error) {
    await settleTaskEscalation(
      db,
      claim,
      taskDeliveryFailure(error, claim.attempts, effectStarted),
      clock(),
    );
  }
  return { kind: 'progress' };
}
