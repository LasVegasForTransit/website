import { t } from '@lasvegasfortransit/platform-core/messages';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  claimTaskCardRefresh,
  readTaskCardRefresh,
  settleTaskCardRefresh,
  type TaskCardRefresh,
} from '@lasvegasfortransit/platform-storage/notion-task-refresh';
import { ensureTaskCard } from '@lasvegasfortransit/platform-storage/notion-task-cards';
import { readTaskCheckinPolicy, type TaskCheckinPolicy } from './notion-task-policy';
import { NotionTaskApiError, type NotionTaskClient } from './notion-task-client';
import type { DiscordTaskClient } from './notion-task-discord';
import { DiscordApiFailure } from './discord-types';
import { parseNotionTaskPage } from './notion-task-reader';
import { hydrateNotionTask } from './notion-task-hydrate';
import { sameTaskSnapshot } from './notion-task-current';
import { renderTaskCard, type DiscordTaskMessage, type TaskCardState } from './notion-task-cards';
function staleCard(): DiscordTaskMessage {
  return {
    flags: 32768,
    allowed_mentions: { parse: [] },
    components: [{ type: 17, components: [{ type: 10, content: t('taskCheckins.stale') }] }],
  };
}
function displayState(refresh: TaskCardRefresh, current: boolean): TaskCardState {
  if (refresh.operation_state === 'confirmed')
    return refresh.operation_kind === 'snooze' ? 'snoozed' : 'confirmed';
  if (refresh.operation_state === 'held' || refresh.operation_state === 'failed') return 'failed';
  if (refresh.operation_state === 'superseded')
    return refresh.operation_reason === 'staff_closed' ? 'failed' : current ? 'changed' : 'stale';
  if (refresh.operation_state) return 'pending';
  return current ? 'ready' : 'stale';
}
async function readFreshTask(
  notion: NotionTaskClient,
  refresh: TaskCardRefresh,
  policy: TaskCheckinPolicy,
) {
  try {
    const hydrated = await hydrateNotionTask(notion, await notion.readPage(refresh.task_id), {
      ...policy,
      sourceId: refresh.source_id,
    });
    const parsed = parseNotionTaskPage(hydrated.page, hydrated.options);
    if (
      parsed?.taskId.replaceAll('-', '') !== refresh.task_id.replaceAll('-', '') ||
      !parsed.snapshot.assigneeIds.includes(refresh.notion_user_id)
    )
      return null;
    if (parsed.snapshot.ineligibleReason && parsed.snapshot.ineligibleReason !== 'completed')
      return null;
    return parsed;
  } catch (error) {
    if (error instanceof NotionTaskApiError && ['http_403', 'http_404'].includes(error.code))
      return null;
    throw error;
  }
}
async function prepareCard(
  db: Db,
  notion: NotionTaskClient,
  refresh: TaskCardRefresh,
  input: { policy: TaskCheckinPolicy; clock: () => Date },
) {
  const fresh = await readFreshTask(notion, refresh, input.policy);
  if (!fresh) return { message: staleCard(), token: refresh.token };
  const current = sameTaskSnapshot(refresh.snapshot_json, fresh.snapshot);
  const active = current && fresh.active && refresh.task_active === 1;
  const card = active
    ? await ensureTaskCard(
        db,
        { sourceId: refresh.source_id, taskId: refresh.task_id, personId: refresh.person_id },
        input.clock(),
      )
    : null;
  const token = card?.token ?? refresh.token;
  return {
    token,
    message: renderTaskCard({
      token,
      task: fresh.snapshot,
      policy: input.policy,
      active,
      state: displayState(refresh, current),
    }),
  };
}
function refreshFailure(error: unknown, attempts: number) {
  const denied =
    error instanceof DiscordApiFailure &&
    ['permission_denied', 'not_configured'].includes(error.kind);
  return {
    state: denied ? ('failed' as const) : ('retryable' as const),
    reason:
      error instanceof DiscordApiFailure
        ? error.kind
        : error instanceof NotionTaskApiError
          ? error.code
          : 'refresh_unavailable',
    retryAfterMs: Math.max(
      Math.min(3_600_000, 60_000 * 2 ** (attempts - 1)),
      error instanceof DiscordApiFailure
        ? (error.retryAfterMs ?? 0)
        : error instanceof NotionTaskApiError
          ? error.retryAfterMs
          : 0,
    ),
  };
}
/** An edit is idempotent; it may retry after an uncertain PATCH, but never creates another message. */
export async function processTaskCardRefresh(
  db: Db,
  providers: { notion: NotionTaskClient; discord: DiscordTaskClient },
  scope: string | { sourceId: string; taskId: string; personId: string },
  clock: () => Date,
): Promise<{ kind: 'idle' | 'progress' }> {
  const refresh = await claimTaskCardRefresh(
    db,
    typeof scope === 'string' ? scope : scope.sourceId,
    clock(),
    typeof scope === 'string' ? undefined : scope,
  );
  if (!refresh) return { kind: 'idle' };
  try {
    const policy = readTaskCheckinPolicy(refresh.policy_json);
    if (!policy || !(await providers.discord.membership(refresh.discord_user_id, policy.guildId))) {
      await settleTaskCardRefresh(
        db,
        refresh,
        { state: 'superseded', reason: 'authority_changed' },
        clock(),
      );
      return { kind: 'progress' };
    }
    const prepared = await prepareCard(db, providers.notion, refresh, { policy, clock });
    const channelId = await providers.discord.openDM(refresh.discord_user_id);
    const latest = await readTaskCardRefresh(db, refresh, clock());
    if (
      latest?.discord_user_id !== refresh.discord_user_id ||
      latest.channel_id !== channelId ||
      latest.message_id !== refresh.message_id ||
      latest.token !== prepared.token
    ) {
      await settleTaskCardRefresh(
        db,
        refresh,
        { state: 'retryable', reason: 'card_or_authority_changed' },
        clock(),
      );
      return { kind: 'progress' };
    }
    await providers.discord.updateCard(
      channelId,
      latest.discord_user_id,
      latest.message_id,
      prepared.message,
    );
    await settleTaskCardRefresh(db, refresh, { state: 'confirmed' }, clock());
  } catch (error) {
    await settleTaskCardRefresh(db, refresh, refreshFailure(error, refresh.attempts), clock());
  }
  return { kind: 'progress' };
}
