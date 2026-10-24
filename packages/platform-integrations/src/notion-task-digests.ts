import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { readTaskCheckinSource } from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import { reserveTaskNotification } from '@lasvegasfortransit/platform-storage/notion-task-notifications';
import {
  queueTaskDigests,
  claimTaskDigest,
  readTaskDigestContext,
  listTaskDigestTasks,
  settleTaskDigest,
  type TaskDigest,
  type TaskDigestContext,
} from '@lasvegasfortransit/platform-storage/notion-task-digests';
import { readTaskCheckinPolicy, type TaskCheckinPolicy } from './notion-task-policy';
import { taskDigestDay, taskQuietNow } from './notion-task-reminders';
import { hydrateNotionTask } from './notion-task-hydrate';
import { parseNotionTaskPage } from './notion-task-reader';
import type { NotionTaskClient } from './notion-task-client';
import type { DiscordTaskClient } from './notion-task-discord';
import type { NotionTaskSnapshot } from './notion-task-types';
import { renderTaskDigest } from './notion-task-digest-card';
import { taskDeliveryFailure } from './notion-task-delivery';
export async function queueDailyTaskDigests(
  db: Db,
  sourceId: string,
  clock: () => Date,
): Promise<number> {
  const source = await readTaskCheckinSource(db, sourceId);
  const policy = source?.enabled ? readTaskCheckinPolicy(source.policy_json) : null;
  const day = policy && taskDigestDay(policy, clock());
  return day ? queueTaskDigests(db, { sourceId, day }, clock()) : 0;
}
async function currentTasks(
  db: Db,
  notion: NotionTaskClient,
  digest: TaskDigest,
  input: { context: TaskDigestContext; policy: TaskCheckinPolicy; clock: () => Date },
) {
  const rows = await listTaskDigestTasks(db, digest, input.clock());
  const tasks: { id: string; task: NotionTaskSnapshot }[] = [];
  for (const row of rows) {
    const hydrated = await hydrateNotionTask(notion, await notion.readPage(row.task_id), {
      ...input.policy,
      sourceId: digest.source_id,
    });
    const parsed = parseNotionTaskPage(hydrated.page, hydrated.options);
    if (
      parsed?.active &&
      parsed.taskId === row.task_id &&
      parsed.snapshot.assigneeIds.includes(input.context.notion_user_id)
    )
      tasks.push({ id: row.task_id, task: parsed.snapshot });
  }
  return { tasks, more: (rows[0]?.total_count ?? 0) > rows.length };
}
async function prepareDigest(db: Db, digest: TaskDigest, clock: () => Date) {
  const context = await readTaskDigestContext(db, digest, clock());
  const policy = context && readTaskCheckinPolicy(context.policy_json);
  if (!context || !policy) {
    await settleTaskDigest(
      db,
      digest,
      { state: 'superseded', reason: 'authority_changed' },
      clock(),
    );
    return null;
  }
  if (taskQuietNow(policy, clock())) {
    await settleTaskDigest(db, digest, { state: 'deferred', reason: 'quiet_hours' }, clock());
    return null;
  }
  if (taskDigestDay(policy, clock()) !== digest.day) {
    await settleTaskDigest(
      db,
      digest,
      { state: 'superseded', reason: 'digest_day_changed' },
      clock(),
    );
    return null;
  }
  return { context, policy };
}
async function prepareDigestMessage(
  db: Db,
  providers: { notion: NotionTaskClient; discord: DiscordTaskClient },
  digest: TaskDigest,
  input: { context: TaskDigestContext; policy: TaskCheckinPolicy; clock: () => Date },
) {
  const { clock } = input;
  if (!(await providers.discord.membership(input.context.discord_user_id, input.policy.guildId))) {
    await settleTaskDigest(
      db,
      digest,
      { state: 'superseded', reason: 'guild_membership_changed' },
      clock(),
    );
    return null;
  }
  const selected = await currentTasks(db, providers.notion, digest, input);
  const channelId = selected.tasks.length
    ? await providers.discord.openDM(input.context.discord_user_id)
    : null;
  const latest = await readTaskDigestContext(db, digest, clock());
  if (
    !channelId ||
    latest?.discord_user_id !== input.context.discord_user_id ||
    latest.policy_json !== input.context.policy_json
  ) {
    await settleTaskDigest(
      db,
      digest,
      { state: 'superseded', reason: 'authority_or_tasks_changed' },
      clock(),
    );
    return null;
  }
  const allowed = new Set(
    (await listTaskDigestTasks(db, digest, clock())).map((row) => row.task_id),
  );
  const tasks = selected.tasks.filter((row) => allowed.has(row.id)).map((row) => row.task);
  if (!tasks.length) {
    await settleTaskDigest(
      db,
      digest,
      { state: 'superseded', reason: 'no_current_tasks' },
      clock(),
    );
    return null;
  }
  return {
    channelId,
    userId: latest.discord_user_id,
    card: renderTaskDigest({ day: digest.day, tasks, more: selected.more }),
  };
}
export async function processDailyTaskDigest(
  db: Db,
  providers: { notion: NotionTaskClient; discord: DiscordTaskClient },
  sourceId: string,
  clock: () => Date,
): Promise<{ kind: 'idle' | 'progress' }> {
  const digest = await claimTaskDigest(db, sourceId, clock());
  if (!digest) return { kind: 'idle' };
  let effectStarted = false;
  try {
    const current = await prepareDigest(db, digest, clock);
    if (!current) return { kind: 'progress' };
    const prepared = await prepareDigestMessage(db, providers, digest, { ...current, clock });
    if (!prepared) return { kind: 'progress' };
    const { channelId } = prepared;
    if (!(await reserveTaskNotification(db, { kind: 'digest', operation: digest }, clock()))) {
      await settleTaskDigest(
        db,
        digest,
        { state: 'deferred', reason: 'notification_limit' },
        clock(),
      );
      return { kind: 'progress' };
    }
    effectStarted = true;
    const sent = await providers.discord.sendCard(
      channelId,
      prepared.userId,
      prepared.card,
      digest.id,
    );
    if (
      !(await settleTaskDigest(
        db,
        digest,
        { state: 'confirmed', result: { channelId, messageId: sent.messageId } },
        clock(),
      ))
    )
      await settleTaskDigest(
        db,
        digest,
        {
          state: 'held',
          reason: 'unconfirmed_effect',
          result: { channelId, messageId: sent.messageId },
        },
        clock(),
      );
  } catch (error) {
    await settleTaskDigest(
      db,
      digest,
      taskDeliveryFailure(error, digest.attempts, effectStarted),
      clock(),
    );
  }
  return { kind: 'progress' };
}

/** Keep a busy morning bounded by both query count (four receipts plus shared rate-limit reads) and wall time. */
export async function runDailyTaskDigestBatch(
  db: Db,
  providers: { notion: NotionTaskClient; discord: DiscordTaskClient },
  sourceId: string,
  clock: () => Date,
): Promise<{ queued: number; processed: number }> {
  const deadline = clock().getTime() + 45_000;
  const queued = await queueDailyTaskDigests(db, sourceId, clock);
  let processed = 0;
  while (processed < 4 && clock().getTime() < deadline) {
    const result = await processDailyTaskDigest(db, providers, sourceId, clock);
    if (result.kind === 'idle') break;
    processed++;
  }
  return { queued, processed };
}
