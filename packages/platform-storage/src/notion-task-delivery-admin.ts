import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db, Statement } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditedTaskCheckinChange } from './notion-task-admin-audit';
import { TASK_RECIPIENT_AUTHORITY_SQL as ELIGIBLE } from './notion-task-recipients';
import { taskMappingMatches } from './notion-task-person-lineage';
export interface TaskDeliveryIssue {
  kind: 'digest' | 'refresh';
  id: string;
  person_id: string;
  person_name: string | null;
  task_id: string | null;
  task_title: string | null;
  day: string | null;
  state: string;
  reason: string | null;
  updated_at: string;
  generation: number | null;
  safe_retry: number;
}
interface DeliveryActionOptions {
  now: Date;
  retry: boolean;
}
interface IssueInput {
  sourceId: string;
  kind: 'digest' | 'refresh';
  id: string;
  expectedUpdatedAt: string;
  expectedGeneration: number | null;
}
const REFRESH_VIEW = `SELECT f.source_id,f.task_id,f.person_id,s.revision AS policy_revision,
  c.revision AS consent_revision,m.notion_user_id,card.channel_id,card.message_id
  FROM task_checkin_card_refreshes f JOIN task_checkin_sources s ON s.id=f.source_id
  JOIN task_checkin_consents c ON c.source_id=f.source_id AND c.person_id=f.person_id
  JOIN task_checkin_mappings m ON m.workspace_id=s.workspace_id AND ${taskMappingMatches('m', 'f.person_id')}
  JOIN task_checkin_cards card ON card.source_id=f.source_id AND card.task_id=f.task_id AND card.person_id=f.person_id`;
const REFRESH_READY = `EXISTS(SELECT 1 FROM (${REFRESH_VIEW}) o WHERE o.source_id=r.source_id
  AND o.task_id=r.task_id AND o.person_id=r.person_id AND o.channel_id IS NOT NULL AND o.message_id IS NOT NULL AND ${ELIGIBLE})`;
export async function readTaskDeliveryIssues(db: Db, actor: Actor, sourceId: string, cursor = '') {
  if (!(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actor.personId).first()))
    throw new PermissionDenied('staff_admin.manage');
  const rows = await db
    .prepare(
      `SELECT * FROM (
    SELECT 'digest' AS kind,o.id,o.person_id,nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),'') AS person_name,
      NULL AS task_id,NULL AS task_title,o.day,o.state,o.reason,o.updated_at,NULL AS generation,
      CASE WHEN o.state IN ('failed','retryable') AND ${ELIGIBLE} THEN 1 ELSE 0 END AS safe_retry
    FROM task_checkin_digests o JOIN people p ON p.id=o.person_id
    WHERE o.source_id=? AND o.state IN ('failed','retryable','held') AND ${STAFF_ADMIN_SCOPE}
    UNION ALL
    SELECT 'refresh',json_array(r.task_id,r.person_id),r.person_id,
      nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),''),r.task_id,
      json_extract(t.snapshot_json,'$.title'),NULL,r.state,r.reason,r.updated_at,r.generation,
      CASE WHEN r.state IN ('failed','retryable') AND ${REFRESH_READY} THEN 1 ELSE 0 END
    FROM task_checkin_card_refreshes r JOIN people p ON p.id=r.person_id
      JOIN task_checkin_tasks t ON t.source_id=r.source_id AND t.task_id=r.task_id
    WHERE r.source_id=? AND r.state IN ('failed','retryable') AND ${STAFF_ADMIN_SCOPE}
  ) WHERE kind||':'||id>? ORDER BY kind,id LIMIT 51`,
    )
    .bind(sourceId, actor.personId, sourceId, actor.personId, cursor)
    .all<TaskDeliveryIssue>();
  const items = rows.results.slice(0, 50),
    last = items.at(-1);
  return { items, nextCursor: rows.results.length > 50 && last ? `${last.kind}:${last.id}` : null };
}
function refreshKey(value: string): [string, string] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      parsed.some((key: unknown) => typeof key !== 'string' || !key || key.length > 200)
    )
      return null;
    return parsed as [string, string];
  } catch {
    return null;
  }
}
function digestMutation(
  db: Db,
  actor: Actor,
  input: IssueInput,
  options: DeliveryActionOptions,
): Statement {
  const { now, retry } = options;
  return db
    .prepare(
      `UPDATE task_checkin_digests AS o SET state=?,reason=?,
    attempts=CASE WHEN ? THEN 0 ELSE attempts END,claim_token=NULL,lease_expires_at=NULL,next_attempt_at=?,updated_at=?
    WHERE id=? AND source_id=? AND updated_at=? AND ${STAFF_ADMIN_SCOPE}
      AND ${retry ? `state IN ('failed','retryable') AND ${ELIGIBLE}` : "state IN ('failed','retryable','held')"}`,
    )
    .bind(
      retry ? 'queued' : 'superseded',
      retry ? null : 'staff_closed',
      Number(retry),
      now.toISOString(),
      now.toISOString(),
      input.id,
      input.sourceId,
      input.expectedUpdatedAt,
      actor.personId,
    );
}
function refreshMutation(
  db: Db,
  actor: Actor,
  input: IssueInput,
  options: DeliveryActionOptions,
): Statement | null {
  const { now, retry } = options;
  const key = refreshKey(input.id);
  if (!key || !Number.isInteger(input.expectedGeneration) || Number(input.expectedGeneration) < 1)
    return null;
  return db
    .prepare(
      `UPDATE task_checkin_card_refreshes AS r SET state=?,reason=?,generation=generation+?,
    attempts=CASE WHEN ? THEN 0 ELSE attempts END,claim_token=NULL,lease_expires_at=NULL,claimed_generation=NULL,next_attempt_at=?,updated_at=?
    WHERE source_id=? AND task_id=? AND person_id=? AND generation=? AND updated_at=?
      AND state IN ('failed','retryable') AND ${STAFF_ADMIN_SCOPE} ${retry ? `AND ${REFRESH_READY}` : ''}`,
    )
    .bind(
      retry ? 'queued' : 'superseded',
      retry ? null : 'staff_closed',
      Number(retry),
      Number(retry),
      now.toISOString(),
      now.toISOString(),
      input.sourceId,
      ...key,
      input.expectedGeneration,
      input.expectedUpdatedAt,
      actor.personId,
    );
}
async function change(
  db: Db,
  actor: Actor,
  input: IssueInput,
  options: DeliveryActionOptions,
): Promise<boolean> {
  const { now, retry } = options;
  const mutation =
    input.kind === 'digest'
      ? digestMutation(db, actor, input, options)
      : refreshMutation(db, actor, input, options);
  if (!mutation) return false;
  return auditedTaskCheckinChange(db, actor, {
    mutation,
    action: retry ? 'task_checkins.delivery_retry' : 'task_checkins.delivery_close',
    targetId: input.id,
    now,
  });
}
export function retryTaskDeliveryIssue(db: Db, actor: Actor, input: IssueInput, now: Date) {
  return change(db, actor, input, { now, retry: true });
}
export function closeTaskDeliveryIssue(db: Db, actor: Actor, input: IssueInput, now: Date) {
  return change(db, actor, input, { now, retry: false });
}
