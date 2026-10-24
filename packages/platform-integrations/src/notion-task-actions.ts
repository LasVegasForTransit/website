import { taskStatusTarget } from './notion-task-status';
import { DiscordApiFailure } from './discord-types';
import { readCurrentNotionTask, type TaskEffectOptions } from './notion-task-current';
import { t } from '@lasvegasfortransit/platform-core/messages';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  claimTaskOperation,
  completeTaskOperation,
  confirmTaskSnooze,
  readHeldTaskComment,
  confirmHeldTaskComment,
  type TaskOperation,
} from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import { NotionTaskApiError, type NotionTaskClient } from './notion-task-client';
import { notionObject, notionProperty } from './notion-task-types';

function reference(operation: TaskOperation): string {
  const url = new URL(`https://www.notion.so/${operation.task_id.replaceAll('-', '')}`);
  url.searchParams.set('lvbt_update', operation.id);
  return url.href;
}
function comment(operation: TaskOperation, notionUserId: string): unknown[] {
  const text = notionObject(JSON.parse(operation.payload_json) as unknown).text;
  if (typeof text !== 'string' || !text.trim() || text.length > 1800)
    throw new NotionTaskApiError('invalid_response_text', 60_000, false);
  const labels = {
    progress: t('taskCheckins.progressComment'),
    blocker: t('taskCheckins.blockerComment'),
    extension: t('taskCheckins.extensionComment'),
  };
  if (!(operation.kind in labels)) throw new NotionTaskApiError('invalid_action', 60_000, false);
  return [
    {
      type: 'text',
      text: {
        content: t('taskCheckins.commentAuthor', {
          kind: labels[operation.kind as keyof typeof labels],
        }),
      },
    },
    { type: 'mention', mention: { type: 'user', user: { object: 'user', id: notionUserId } } },
    { type: 'text', text: { content: `\n${text}\n` } },
    {
      type: 'text',
      text: { content: t('taskCheckins.commentSource'), link: { url: reference(operation) } },
    },
  ];
}
function failure(error: unknown, attempts: number) {
  const backoff = Math.min(3_600_000, 60_000 * 2 ** (attempts - 1));
  // Discord is consulted only before the Notion effect, so these failures are safe to retry.
  if (error instanceof DiscordApiFailure)
    return {
      state: error.kind === 'permission_denied' ? ('failed' as const) : ('retryable' as const),
      reason: error.kind,
      retryAfterMs: Math.max(backoff, error.retryAfterMs ?? 0),
    };
  if (!(error instanceof NotionTaskApiError))
    return { state: 'held' as const, reason: 'unconfirmed_effect' };
  return {
    state: error.effectMayHaveApplied
      ? ('held' as const)
      : error.retryable
        ? ('retryable' as const)
        : ('failed' as const),
    reason: error.effectMayHaveApplied ? 'unconfirmed_effect' : error.code,
    retryAfterMs: Math.max(backoff, error.retryAfterMs),
  };
}
/** Provider effects happen only after a durable claim and a fresh source/actor authorization check. */
export async function processNotionTaskAction(
  db: Db,
  client: NotionTaskClient,
  id: string,
  options: TaskEffectOptions,
): Promise<void> {
  const operation = await claimTaskOperation(db, id, options.clock());
  if (!operation) return;
  const lease = { id: operation.id, token: operation.claim_token };
  try {
    const current = await readCurrentNotionTask(db, client, operation, options);
    if (!current) {
      await completeTaskOperation(
        db,
        lease,
        { state: 'superseded', reason: 'authority_or_task_changed' },
        options.clock(),
      );
      return;
    }
    if (operation.kind === 'snooze') {
      await confirmTaskSnooze(db, operation, current.policy.snoozeMinutes, options.clock());
      return;
    }
    const status = taskStatusTarget(JSON.parse(operation.payload_json));
    if (operation.kind === 'complete' && !status)
      throw new NotionTaskApiError('invalid_status', 60_000, false);
    const response = notionObject(
      operation.kind === 'complete'
        ? await client.setTaskStatus(
            operation.task_id,
            current.policy.fields.status,
            status ?? 'Done',
          )
        : await client.createTaskComment(
            operation.task_id,
            comment(operation, current.context.notion_user_id),
          ),
    );
    if (
      typeof response.id !== 'string' ||
      (operation.kind === 'complete'
        ? notionObject(notionProperty(response, current.policy.fields.status).status).name !==
          status
        : response.object !== 'comment')
    )
      throw new NotionTaskApiError('unconfirmed_response', 60_000, false, true);
    await completeTaskOperation(
      db,
      lease,
      { state: 'confirmed', result: { providerId: response.id } },
      options.clock(),
    );
  } catch (error) {
    await completeTaskOperation(db, lease, failure(error, operation.attempts), options.clock());
  }
}
function matchesReference(value: unknown, operation: TaskOperation, botId: string): boolean {
  const row = notionObject(value),
    parent = notionObject(row.parent);
  if (
    row.object !== 'comment' ||
    notionObject(row.created_by).id !== botId ||
    typeof row.id !== 'string' ||
    parent.page_id !== operation.task_id ||
    !Array.isArray(row.rich_text)
  )
    return false;
  return row.rich_text.some(
    (part: unknown) =>
      notionObject(notionObject(notionObject(part).text).link).url === reference(operation),
  );
}
/** A positive bot-authored reference is evidence. Absence from unresolved comments is not. */
export async function findNotionTaskComment(
  client: NotionTaskClient,
  operation: TaskOperation,
): Promise<string | null> {
  const bot = notionObject(await client.readSelf());
  if (bot.type !== 'bot' || typeof bot.id !== 'string') return null;
  let cursor: string | null = null;
  const cursors = new Set<string>();
  for (let count = 0; count < 5; count++) {
    const page = await client.listTaskComments(operation.task_id, cursor);
    const found = page.results.find((row) => matchesReference(row, operation, bot.id as string));
    if (found) return String(notionObject(found).id);
    cursor = page.nextCursor;
    if (!cursor || cursors.has(cursor)) return null;
    cursors.add(cursor);
  }
  return null;
}
/** Never authorizes another POST when a previous comment write cannot be confirmed. */
export async function reconcileNotionTaskComment(
  db: Db,
  client: NotionTaskClient,
  id: string,
  clock: () => Date,
): Promise<void> {
  const operation = await readHeldTaskComment(db, id);
  if (!operation) return;
  const commentId = await findNotionTaskComment(client, operation);
  if (commentId) await confirmHeldTaskComment(db, id, commentId, clock());
}
