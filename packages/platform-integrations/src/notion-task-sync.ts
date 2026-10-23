import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import {
  readTaskCheckinSource,
  upsertNotionTaskSnapshot,
} from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import {
  claimTaskScan,
  completeTaskScanPage,
  failTaskScan,
  type TaskScanSnapshot,
} from '@lasvegasfortransit/platform-storage/notion-task-scans';
import { NotionTaskApiError, type NotionTaskClient } from './notion-task-client';
import { hydrateNotionTask } from './notion-task-hydrate';
import { parseNotionTaskPage } from './notion-task-reader';
import { resolveNotionTaskEscalation } from './notion-task-projects';
import {
  notionObject,
  type NotionTaskFields,
  type NotionTaskReadOptions,
} from './notion-task-types';

function readOptions(sourceId: string, json: string): NotionTaskReadOptions | null {
  let policy: Record<string, unknown>;
  try {
    policy = notionObject(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
  const fields = notionObject(policy.fields);
  if (
    ['name', 'description', 'assignee', 'due', 'status', 'project'].some(
      (key) => typeof fields[key] !== 'string' || !fields[key] || fields[key].length > 100,
    )
  )
    return null;
  if (
    policy.rangeBoundary !== 'reject' &&
    policy.rangeBoundary !== 'start' &&
    policy.rangeBoundary !== 'end'
  )
    return null;
  if (typeof policy.shareDescription !== 'boolean') return null;
  return {
    sourceId,
    fields: fields as unknown as NotionTaskFields,
    rangeBoundary: policy.rangeBoundary,
    shareDescription: policy.shareDescription,
    ...(typeof policy.projectsSourceId === 'string'
      ? { projectsSourceId: policy.projectsSourceId }
      : {}),
    ...(typeof policy.projectLeadField === 'string'
      ? { projectLeadField: policy.projectLeadField }
      : {}),
  };
}
export type TaskSyncResult =
  | { kind: 'idle' | 'configuration_required' | 'stale' }
  | { kind: 'scanned'; complete: boolean; count: number }
  | { kind: 'failed'; reason: string };

/** One source page per invocation; its task snapshots and checkpoint commit together. */
export async function syncNotionTaskPage(
  db: Db,
  client: NotionTaskClient,
  sourceId: string,
  clock: () => Date = () => new Date(),
): Promise<TaskSyncResult> {
  const source = await readTaskCheckinSource(db, sourceId);
  if (!source) return { kind: 'idle' };
  const options = readOptions(sourceId, source.policy_json);
  if (!options) return { kind: 'configuration_required' };
  const claim = await claimTaskScan(db, sourceId, clock());
  if (!claim) return { kind: 'idle' };
  if (claim.policy_revision !== source.revision) {
    await failTaskScan(db, claim, { reason: 'policy_changed', retryAfterMs: 1000 }, clock());
    return { kind: 'stale' };
  }
  try {
    const page = await client.queryTasks(sourceId, claim.cursor);
    if (page.nextCursor !== null && page.nextCursor === claim.cursor)
      throw new NotionTaskApiError('repeated_cursor');
    const tasks: TaskScanSnapshot[] = [];
    const projects = new Map<string, Promise<string[] | null>>();
    for (const row of page.results) {
      const hydrated = await hydrateNotionTask(client, row, options);
      const parsed = parseNotionTaskPage(hydrated.page, hydrated.options);
      if (!parsed) throw new NotionTaskApiError('malformed_task');
      Object.assign(
        parsed.snapshot,
        await resolveNotionTaskEscalation(client, parsed.snapshot.projectIds, options, projects),
      );
      tasks.push({
        ...parsed,
        revision: await digestToken(
          JSON.stringify({ active: parsed.active, snapshot: parsed.snapshot }),
        ),
      });
    }
    const committed = await completeTaskScanPage(
      db,
      claim,
      { tasks, nextCursor: page.nextCursor },
      clock(),
    );
    return committed
      ? { kind: 'scanned', complete: page.nextCursor === null, count: tasks.length }
      : { kind: 'stale' };
  } catch (error) {
    const reason = error instanceof NotionTaskApiError ? error.code : 'sync_unavailable';
    await failTaskScan(
      db,
      claim,
      { reason, retryAfterMs: error instanceof NotionTaskApiError ? error.retryAfterMs : 60_000 },
      clock(),
    );
    return { kind: 'failed', reason };
  }
}

/** Refresh only the task changed by a human action before claiming its card edit. */
export async function syncNotionTaskSnapshot(
  db: Db,
  client: NotionTaskClient,
  input: { sourceId: string; taskId: string },
  clock: () => Date,
): Promise<void> {
  const source = await readTaskCheckinSource(db, input.sourceId);
  const options = source && readOptions(input.sourceId, source.policy_json);
  if (!source?.enabled || !options) return;
  const hydrated = await hydrateNotionTask(client, await client.readPage(input.taskId), options);
  const parsed = parseNotionTaskPage(hydrated.page, hydrated.options);
  if (parsed?.taskId.replaceAll('-', '') !== input.taskId.replaceAll('-', '')) return;
  Object.assign(
    parsed.snapshot,
    await resolveNotionTaskEscalation(client, parsed.snapshot.projectIds, options, new Map()),
  );
  await upsertNotionTaskSnapshot(
    db,
    {
      sourceId: input.sourceId,
      ...parsed,
      revision: await digestToken(
        JSON.stringify({ active: parsed.active, snapshot: parsed.snapshot }),
      ),
    },
    clock(),
  );
}
