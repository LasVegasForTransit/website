import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditedTaskCheckinChange } from './notion-task-admin-audit';
import { taskPersonCanonical, taskPersonOrigins } from './notion-task-person-lineage';
import { mappingCorrectionWrites } from './notion-task-mapping-effects';
import { notionAssigneeNameSql } from './notion-task-assignee-name';

export interface TaskCheckinMapping {
  notion_user_id: string;
  notion_name: string | null;
  person_id: string;
  person_name: string | null;
  person_email: string | null;
  person_record_id: string | null;
  conflicting_notion_user_id: string | null;
  task_id: string | null;
  version: string;
}
const MAPPING_VIEW = `SELECT m.notion_user_id,m.person_id,m.version,p.email AS person_email,p.id AS person_record_id,
  (SELECT conflict.notion_user_id FROM task_checkin_mappings conflict WHERE conflict.workspace_id=m.workspace_id
    AND conflict.notion_user_id<>m.notion_user_id AND conflict.person_id IN (${taskPersonOrigins('p.id')})
    ORDER BY conflict.notion_user_id LIMIT 1) AS conflicting_notion_user_id,
  (SELECT assigned.task_id FROM task_checkin_tasks assigned WHERE assigned.source_id=s.id
    AND EXISTS(SELECT 1 FROM json_each(assigned.snapshot_json,'$.assigneeIds') a WHERE a.value=m.notion_user_id)
    ORDER BY assigned.active DESC,assigned.updated_at DESC,assigned.task_id LIMIT 1) AS task_id,
  ${notionAssigneeNameSql('s.id', 'm.notion_user_id')} AS notion_name,
  coalesce(nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),''),p.email) AS person_name
  FROM task_checkin_mappings m JOIN task_checkin_sources s ON s.workspace_id=m.workspace_id
  LEFT JOIN people p ON p.id=(${taskPersonCanonical('m.person_id')})`;
export async function readTaskCheckinMapping(
  db: Db,
  actor: Actor,
  input: { sourceId: string; notionUserId: string },
): Promise<TaskCheckinMapping | null> {
  if (!(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actor.personId).first()))
    throw new PermissionDenied('staff_admin.manage');
  return db
    .prepare(`${MAPPING_VIEW} WHERE s.id=? AND m.notion_user_id=? AND ${STAFF_ADMIN_SCOPE}`)
    .bind(input.sourceId, input.notionUserId, actor.personId)
    .first<TaskCheckinMapping>();
}
export async function listTaskCheckinMappings(
  db: Db,
  actor: Actor,
  input: { sourceId: string; cursor?: string },
) {
  if (!(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actor.personId).first()))
    throw new PermissionDenied('staff_admin.manage');
  const rows = await db
    .prepare(
      `${MAPPING_VIEW} WHERE s.id=? AND m.notion_user_id>? AND ${STAFF_ADMIN_SCOPE}
    ORDER BY m.notion_user_id LIMIT 51`,
    )
    .bind(input.sourceId, input.cursor ?? '', actor.personId)
    .all<TaskCheckinMapping>();
  const items = rows.results.slice(0, 50);
  return {
    items,
    nextCursor: rows.results.length > 50 ? (items.at(-1)?.notion_user_id ?? null) : null,
  };
}
/** Explicit compare-and-set correction; history never changes its recording owner. */
export function correctTaskCheckinMapping(
  db: Db,
  actor: Actor,
  input: {
    sourceId: string;
    expectedRevision: number;
    notionUserId: string;
    expectedVersion: string;
    expectedPersonId: string;
    personId: string | null;
  },
  now: Date,
): Promise<boolean> {
  const guard = `m.notion_user_id=? AND m.person_id=? AND m.version=?
    AND m.workspace_id=(SELECT s.workspace_id FROM task_checkin_sources s WHERE s.id=? AND s.revision=? AND ${STAFF_ADMIN_SCOPE})`;
  const values = [
    input.notionUserId,
    input.expectedPersonId,
    input.expectedVersion,
    input.sourceId,
    input.expectedRevision,
    actor.personId,
  ];
  const mutation =
    input.personId === null
      ? db.prepare(`DELETE FROM task_checkin_mappings AS m WHERE ${guard}`).bind(...values)
      : db
          .prepare(
            `UPDATE task_checkin_mappings AS m SET person_id=?,confirmed_by=?,confirmed_at=?,version=lower(hex(randomblob(16)))
      WHERE ${guard} AND m.person_id<>?
      AND EXISTS(SELECT 1 FROM people WHERE id=? AND deleted_at IS NULL AND erased_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM task_checkin_mappings other WHERE other.workspace_id=m.workspace_id
        AND other.notion_user_id<>m.notion_user_id AND other.person_id IN (${taskPersonOrigins('?')}))`,
          )
          .bind(
            input.personId,
            actor.personId,
            now.toISOString(),
            ...values,
            input.personId,
            input.personId,
            input.personId,
          );
  return auditedTaskCheckinChange(db, actor, {
    mutation,
    action: input.personId === null ? 'task_checkins.unmap' : 'task_checkins.remap',
    targetId: input.expectedPersonId,
    now,
    after: (auditId) =>
      mappingCorrectionWrites(db, {
        sourceId: input.sourceId,
        auditId,
        personIds: [input.expectedPersonId, ...(input.personId === null ? [] : [input.personId])],
        stamp: now.toISOString(),
      }),
  });
}
