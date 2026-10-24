import {
  taskPersonCanonical,
  taskPersonOrigins,
  taskMappingMatches,
} from './notion-task-person-lineage';
import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import { auditedTaskCheckinChange as auditedChange } from './notion-task-admin-audit';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { TASK_CHECKIN_AUTHORITY_SQL } from './notion-task-authority';
import type { TaskCheckinSource } from './notion-task-checkins';
import { TASK_OPERATION_RETAINED_SQL as RETAINED } from './notion-task-operation-retention';
import { readTaskDeliveryIssues } from './notion-task-delivery-admin';
import { taskCheckinReadiness } from './notion-task-readiness';
import { notionAssigneeNameSql } from './notion-task-assignee-name';

interface UnmappedTaskAssignee {
  notion_user_id: string;
  task_id: string;
  notion_name: string | null;
}
export interface TaskRecoveryRow {
  id: string;
  task_id: string;
  person_id: string;
  kind: string;
  state: string;
  person_name: string | null;
  task_title: string | null;
  reason: string | null;
  updated_at: string;
  safe_retry: number;
  can_reconcile: number;
  recovery_state: string | null;
  recovery_reason: string | null;
}
export type { HeldTask, TaskParticipant } from './notion-task-readiness';
export async function requireTaskCheckinAdmin(db: Db, actor: Actor): Promise<void> {
  if (!(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actor.personId).first()))
    throw new PermissionDenied('staff_admin.manage');
}
export async function taskCheckinReview(
  db: Db,
  actor: Actor,
  sourceId: string,
  options: {
    cursor?: string;
    now?: Date;
    heldCursor?: string;
    personCursor?: string;
    deliveryCursor?: string;
  } = {},
) {
  const now = options.now ?? new Date(),
    cursor = options.cursor ?? '';
  await requireTaskCheckinAdmin(db, actor);
  const source = await db
    .prepare(
      `SELECT s.*,(SELECT not_before FROM task_checkin_provider_backoffs b WHERE b.source_id=s.id) AS provider_not_before,
      scan.reason AS scan_reason,scan.last_completed_at AS scan_last_completed_at
      FROM task_checkin_sources s LEFT JOIN task_checkin_scans scan ON scan.source_id=s.id WHERE s.id=? AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(sourceId, actor.personId)
    .first<
      TaskCheckinSource & {
        provider_not_before: string | null;
        scan_reason: string | null;
        scan_last_completed_at: string | null;
      }
    >();
  const unmapped = await db
    .prepare(
      `SELECT DISTINCT a.value AS notion_user_id,min(t.task_id) AS task_id,
      ${notionAssigneeNameSql('s.id', 'a.value')} AS notion_name
    FROM task_checkin_sources s JOIN task_checkin_tasks t ON t.source_id=s.id
    JOIN json_each(t.snapshot_json,'$.assigneeIds') a
    WHERE s.id=? AND t.active=1 AND a.type='text' AND NOT EXISTS(
      SELECT 1 FROM task_checkin_mappings m JOIN people mapped ON mapped.id=(${taskPersonCanonical('m.person_id')})
      WHERE m.workspace_id=s.workspace_id AND m.notion_user_id=a.value AND ${taskMappingMatches('m', 'mapped.id')})
    AND ${STAFF_ADMIN_SCOPE} GROUP BY a.value ORDER BY a.value LIMIT 101`,
    )
    .bind(sourceId, actor.personId)
    .all<UnmappedTaskAssignee>();
  const operations = await db
    .prepare(
      `SELECT o.id,o.task_id,o.person_id,o.kind,o.state,o.reason,o.updated_at,
    recovery.state AS recovery_state,recovery.reason AS recovery_reason,
    CASE WHEN o.state='held' AND o.reason='unconfirmed_effect' AND o.kind IN ('progress','blocker','extension') THEN 1 ELSE 0 END AS can_reconcile,
    nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),'') AS person_name,
    coalesce(json_extract(t.snapshot_json,'$.title'),json_extract(t.snapshot_json,'$.name')) AS task_title,
    CASE WHEN o.state IN ('failed','retryable') AND ${TASK_CHECKIN_AUTHORITY_SQL} AND ${RETAINED} THEN 1 ELSE 0 END AS safe_retry
    FROM task_checkin_operations o LEFT JOIN task_checkin_recovery recovery ON recovery.operation_id=o.id
    JOIN people p ON p.id=o.person_id
    JOIN task_checkin_tasks t ON t.source_id=o.source_id AND t.task_id=o.task_id WHERE o.source_id=? AND o.id>? AND o.state IN ('failed','retryable','held')
    AND ${STAFF_ADMIN_SCOPE} ORDER BY o.id LIMIT 51`,
    )
    .bind(now.toISOString(), sourceId, cursor, actor.personId)
    .all<TaskRecoveryRow>();
  const items = operations.results.slice(0, 50);
  const readiness = await taskCheckinReadiness(db, actor, sourceId, options);
  const deliveryIssues = await readTaskDeliveryIssues(
    db,
    actor,
    sourceId,
    options.deliveryCursor ?? '',
  );
  return {
    ...readiness,
    deliveryIssues,
    source,
    unmapped: unmapped.results.slice(0, 100),
    moreUnmapped: unmapped.results.length > 100,
    operations: {
      items,
      nextCursor: operations.results.length > 50 ? (items.at(-1)?.id ?? null) : null,
    },
  };
}
export function saveTaskCheckinConfiguration(
  db: Db,
  actor: Actor,
  input: {
    sourceId: string;
    workspaceId: string;
    expectedRevision: number;
    enabled: boolean;
    policy: Record<string, unknown>;
    /** Set only after comparing the complete normalized old and new policy. Never accepts a form flag. */
    preserveConsent?: boolean;
  },
  now: Date,
): Promise<boolean> {
  const values = [
    Number(input.enabled),
    JSON.stringify(input.policy),
    actor.personId,
    now.toISOString(),
  ];
  const mutation =
    input.expectedRevision === 0
      ? db
          .prepare(
            `INSERT OR IGNORE INTO task_checkin_sources(enabled,policy_json,updated_by,updated_at,id,workspace_id,revision)
      SELECT ?,?,?,?,?,?,1 WHERE ${STAFF_ADMIN_SCOPE}`,
          )
          .bind(...values, input.sourceId, input.workspaceId, actor.personId)
      : db
          .prepare(
            `UPDATE task_checkin_sources SET enabled=?,policy_json=?,updated_by=?,updated_at=?,revision=revision+1
      WHERE id=? AND workspace_id=? AND revision=? AND ${STAFF_ADMIN_SCOPE}`,
          )
          .bind(
            ...values,
            input.sourceId,
            input.workspaceId,
            input.expectedRevision,
            actor.personId,
          );
  return auditedChange(db, actor, {
    mutation,
    action: 'task_checkins.configure',
    targetId: input.sourceId,
    now,
    after: (auditId) =>
      input.preserveConsent
        ? [
            db
              .prepare(
                `UPDATE task_checkin_consents SET policy_revision=?
      WHERE source_id=? AND policy_revision=? AND EXISTS(SELECT 1 FROM staff_audits WHERE id=?)`,
              )
              .bind(input.expectedRevision + 1, input.sourceId, input.expectedRevision, auditId),
          ]
        : [],
  });
}
export function confirmTaskCheckinMapping(
  db: Db,
  actor: Actor,
  input: { sourceId: string; expectedRevision: number; notionUserId: string; personId: string },
  now: Date,
): Promise<boolean> {
  const mutation = db
    .prepare(
      `INSERT OR IGNORE INTO task_checkin_mappings(workspace_id,notion_user_id,person_id,confirmed_by,confirmed_at)
    SELECT s.workspace_id,?,?,?,? FROM task_checkin_sources s WHERE s.id=? AND s.revision=?
    AND EXISTS(SELECT 1 FROM people WHERE id=? AND deleted_at IS NULL AND erased_at IS NULL) AND ${STAFF_ADMIN_SCOPE}
    AND NOT EXISTS(SELECT 1 FROM task_checkin_mappings existing WHERE existing.workspace_id=s.workspace_id
      AND existing.person_id IN (${taskPersonOrigins('?')}))`,
    )
    .bind(
      input.notionUserId,
      input.personId,
      actor.personId,
      now.toISOString(),
      input.sourceId,
      input.expectedRevision,
      input.personId,
      actor.personId,
      input.personId,
    );
  return auditedChange(db, actor, {
    mutation,
    action: 'task_checkins.map',
    targetId: input.personId,
    now,
  });
}
/** Held effects require provider reconciliation; resetting them could duplicate a comment or DM. */
export function retryTaskCheckinOperation(
  db: Db,
  actor: Actor,
  input: { sourceId: string; operationId: string; expectedUpdatedAt: string },
  now: Date,
): Promise<boolean> {
  const mutation = db
    .prepare(
      `UPDATE task_checkin_operations AS o SET state='queued',attempts=0,
    claim_token=NULL,lease_expires_at=NULL,reason=NULL,next_attempt_at=?,updated_at=?
    WHERE id=? AND source_id=? AND updated_at=? AND state IN ('failed','retryable')
    AND ${STAFF_ADMIN_SCOPE} AND ${TASK_CHECKIN_AUTHORITY_SQL} AND ${RETAINED}`,
    )
    .bind(
      now.toISOString(),
      now.toISOString(),
      input.operationId,
      input.sourceId,
      input.expectedUpdatedAt,
      actor.personId,
      now.toISOString(),
    );
  return auditedChange(db, actor, {
    mutation,
    action: 'task_checkins.retry',
    targetId: input.operationId,
    now,
  });
}

export async function taskCheckinSources(db: Db, actor: Actor) {
  if (!(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actor.personId).first()))
    throw new PermissionDenied('staff_admin.manage');
  const rows = await db
    .prepare(
      `SELECT id,workspace_id,revision,enabled,policy_json,retention_days FROM task_checkin_sources
    WHERE ${STAFF_ADMIN_SCOPE} ORDER BY id LIMIT 51`,
    )
    .bind(actor.personId)
    .all<TaskCheckinSource>();
  return { items: rows.results.slice(0, 50), hasMore: rows.results.length > 50 };
}

export interface TaskCheckinPersonChoice {
  id: string;
  name: string;
  email: string | null;
}
export async function taskCheckinPeople(db: Db, actor: Actor, selected: string[] = []) {
  if (!(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actor.personId).first()))
    throw new PermissionDenied('staff_admin.manage');
  const rows = await db
    .prepare(
      `SELECT p.id,p.email,coalesce(nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),''),p.email,p.id) AS name
    FROM people p WHERE p.deleted_at IS NULL AND ${STAFF_ADMIN_SCOPE}
    AND (p.id IN (SELECT value FROM json_each(?)) OR p.id IN (SELECT id FROM people WHERE deleted_at IS NULL ORDER BY given_name,family_name,id LIMIT 200))
    ORDER BY name,p.id LIMIT 1201`,
    )
    .bind(actor.personId, JSON.stringify(selected.slice(0, 1001)))
    .all<TaskCheckinPersonChoice>();
  return rows.results;
}
