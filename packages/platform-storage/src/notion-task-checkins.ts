import type { Db } from './db';
import { TASK_SNAPSHOT_UPDATE } from './notion-task-snapshot-sql';
export { setTaskCheckinConsent, readTaskCheckinConsent } from './notion-task-consent';
export {
  recordTaskInteraction,
  enqueueTaskDelivery,
  claimTaskOperation,
  completeTaskOperation,
  readTaskActionContext,
  confirmTaskSnooze,
  readHeldTaskComment,
  confirmHeldTaskComment,
} from './notion-task-operations';
export type {
  TaskOperation,
  TaskOperationInput,
  TaskActionContext,
} from './notion-task-operations';

interface SourceInput {
  sourceId: string;
  workspaceId: string;
  expectedRevision: number;
  enabled: boolean;
  policy: Record<string, unknown>;
  actorId: string;
}
/** Compare-and-set prevents a stale staff page from overwriting newer policy. */
export async function saveTaskCheckinSource(
  db: Db,
  input: SourceInput,
  now: Date,
): Promise<boolean> {
  const values = [
    Number(input.enabled),
    JSON.stringify(input.policy),
    input.actorId,
    now.toISOString(),
  ];
  const result =
    input.expectedRevision === 0
      ? await db
          .prepare(
            `INSERT OR IGNORE INTO task_checkin_sources
      (enabled,policy_json,updated_by,updated_at,id,workspace_id,revision) VALUES(?,?,?,?,?,?,1)`,
          )
          .bind(...values, input.sourceId, input.workspaceId)
          .run()
      : await db
          .prepare(
            `UPDATE task_checkin_sources SET enabled=?,policy_json=?,updated_by=?,updated_at=?,revision=revision+1
      WHERE id=? AND workspace_id=? AND revision=?`,
          )
          .bind(...values, input.sourceId, input.workspaceId, input.expectedRevision)
          .run();
  return result.meta.changes > 0;
}

interface MappingInput {
  workspaceId: string;
  notionUserId: string;
  personId: string;
  confirmedBy: string;
}
/** A conflicting mapping is left unchanged for staff review. Never match by handle. */
export async function putNotionTaskMapping(
  db: Db,
  input: MappingInput,
  now: Date,
): Promise<boolean> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO task_checkin_mappings
    (workspace_id,notion_user_id,person_id,confirmed_by,confirmed_at)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM people WHERE id=? AND deleted_at IS NULL)`,
    )
    .bind(
      input.workspaceId,
      input.notionUserId,
      input.personId,
      input.confirmedBy,
      now.toISOString(),
      input.personId,
    )
    .run();
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM task_checkin_mappings m JOIN people p ON p.id=m.person_id
    WHERE workspace_id=? AND notion_user_id=? AND person_id=? AND p.deleted_at IS NULL`,
      )
      .bind(input.workspaceId, input.notionUserId, input.personId)
      .first(),
  );
}

export interface TaskSnapshotInput {
  sourceId: string;
  taskId: string;
  revision: string;
  sourceEditedAt: string;
  active: boolean;
  snapshot: Record<string, unknown>;
  scanId?: string;
}
export async function upsertNotionTaskSnapshot(
  db: Db,
  input: TaskSnapshotInput,
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO task_checkin_tasks
    (source_id,task_id,revision,source_edited_at,active,snapshot_json,seen_scan_id,updated_at,inactive_since)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,task_id) DO UPDATE SET ${TASK_SNAPSHOT_UPDATE}
    WHERE excluded.source_edited_at>=task_checkin_tasks.source_edited_at`,
    )
    .bind(
      input.sourceId,
      input.taskId,
      input.revision,
      input.sourceEditedAt,
      Number(input.active),
      JSON.stringify(input.snapshot),
      input.scanId ?? null,
      now.toISOString(),
      input.active ? null : now.toISOString(),
    )
    .run();
  return result.meta.changes > 0;
}

export interface TaskCheckinSource {
  id: string;
  workspace_id: string;
  revision: number;
  enabled: number;
  policy_json: string;
  retention_days: number;
}
export function readTaskCheckinSource(db: Db, sourceId: string): Promise<TaskCheckinSource | null> {
  return db
    .prepare('SELECT * FROM task_checkin_sources WHERE id=?')
    .bind(sourceId)
    .first<TaskCheckinSource>();
}
