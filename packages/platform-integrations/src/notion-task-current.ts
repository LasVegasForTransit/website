import { notionObject, type NotionTaskSnapshot } from './notion-task-types';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readTaskActionContext,
  type TaskOperation,
  type TaskActionContext,
} from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import type { NotionTaskClient } from './notion-task-client';
import { readTaskCheckinPolicy, type TaskCheckinPolicy } from './notion-task-policy';
import { hydrateNotionTask } from './notion-task-hydrate';
import { parseNotionTaskPage } from './notion-task-reader';
export interface TaskEffectOptions {
  membership: (discordUserId: string, guildId: string) => Promise<boolean>;
  clock: () => Date;
}
function allowed(operation: TaskOperation, policy: TaskCheckinPolicy): boolean {
  return (
    operation.kind === 'delivery' || operation.kind === 'snooze' || policy.actions[operation.kind]
  );
}
export function sameTaskSnapshot(json: string, task: NotionTaskSnapshot): boolean {
  const stored = notionObject(JSON.parse(json) as unknown);
  return [
    'title',
    'url',
    'description',
    'assigneeIds',
    'projectIds',
    'dueDate',
    'dueTimeZone',
    'status',
    'ineligibleReason',
  ].every((key) => JSON.stringify(stored[key]) === JSON.stringify(task[key]));
}
function stillCurrent(
  parsed: ReturnType<typeof parseNotionTaskPage>,
  context: TaskActionContext,
  operation: TaskOperation,
): parsed is NonNullable<ReturnType<typeof parseNotionTaskPage>> {
  return (
    parsed?.active === true &&
    sameTaskSnapshot(context.snapshot_json, parsed.snapshot) &&
    parsed.taskId.replaceAll('-', '') === operation.task_id.replaceAll('-', '') &&
    parsed.sourceEditedAt === context.source_edited_at &&
    parsed.snapshot.assigneeIds.includes(context.notion_user_id)
  );
}
/** The same fresh-source and current-identity fence applies to Notion effects and private delivery. */
export async function readCurrentNotionTask(
  db: Db,
  client: NotionTaskClient,
  operation: TaskOperation,
  options: TaskEffectOptions,
) {
  const context = await readTaskActionContext(db, operation, options.clock());
  const policy = context && readTaskCheckinPolicy(context.policy_json);
  if (!context || !policy || !allowed(operation, policy)) return null;
  if (!(await options.membership(context.discord_user_id, policy.guildId))) return null;
  const raw = await client.readPage(operation.task_id);
  const hydrated = await hydrateNotionTask(client, raw, {
    ...policy,
    sourceId: operation.source_id,
  });
  const parsed = parseNotionTaskPage(hydrated.page, hydrated.options);
  if (!stillCurrent(parsed, context, operation)) return null;
  const latest = await readTaskActionContext(db, operation, options.clock());
  if (
    latest?.policy_json !== context.policy_json ||
    latest.notion_user_id !== context.notion_user_id ||
    latest.discord_user_id !== context.discord_user_id
  )
    return null;
  return { policy, context, task: parsed.snapshot };
}
