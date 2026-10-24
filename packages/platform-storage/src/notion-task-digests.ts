import { taskMappingMatches, taskPersonOrigins } from './notion-task-person-lineage';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from './db';
import { TASK_RECIPIENT_AUTHORITY_SQL as ELIGIBLE } from './notion-task-recipients';
export interface TaskDigest {
  id: string;
  source_id: string;
  person_id: string;
  day: string;
  policy_revision: number;
  consent_revision: number;
  notion_user_id: string;
  attempts: number;
  claim_token: string;
  lease_expires_at: string;
}
export interface TaskDigestContext {
  policy_json: string;
  discord_user_id: string;
  notion_user_id: string;
}
export async function queueTaskDigests(
  db: Db,
  input: { sourceId: string; day: string },
  now: Date,
): Promise<number> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) throw new Error('Invalid digest day');
  const result = await db
    .prepare(
      `WITH o AS (SELECT s.id AS source_id,c.person_id,s.revision AS policy_revision,c.revision AS consent_revision,m.notion_user_id
    FROM task_checkin_sources s JOIN task_checkin_consents c ON c.source_id=s.id
    JOIN task_checkin_mappings m ON m.workspace_id=s.workspace_id AND ${taskMappingMatches('m', 'c.person_id')} WHERE s.id=?)
    INSERT OR IGNORE INTO task_checkin_digests(id,source_id,person_id,policy_revision,consent_revision,notion_user_id,day,next_attempt_at,created_at,updated_at)
    SELECT o.source_id||':'||o.person_id||':'||?,o.*,?,?,?,? FROM o WHERE ${ELIGIBLE}
    AND NOT EXISTS(SELECT 1 FROM task_checkin_digests d WHERE d.source_id=o.source_id AND d.person_id IN (${taskPersonOrigins('o.person_id')}) AND d.day=?)
    AND EXISTS(SELECT 1 FROM task_checkin_tasks t WHERE t.source_id=o.source_id AND t.active=1
      AND EXISTS(SELECT 1 FROM json_each(t.snapshot_json,'$.assigneeIds') a WHERE a.value=o.notion_user_id))
    ORDER BY o.person_id LIMIT 5`,
    )
    .bind(
      input.sourceId,
      input.day,
      input.day,
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
      input.day,
    )
    .run();
  return result.meta.changes;
}
export async function claimTaskDigest(
  db: Db,
  sourceId: string,
  now: Date,
): Promise<TaskDigest | null> {
  const stamp = now.toISOString();
  await db
    .prepare(
      "UPDATE task_checkin_digests SET state='held',reason='unconfirmed_effect',claim_token=NULL,lease_expires_at=NULL,updated_at=? WHERE source_id=? AND state='processing' AND lease_expires_at<=?",
    )
    .bind(stamp, sourceId, stamp)
    .run();
  return db
    .prepare(
      `UPDATE task_checkin_digests AS o SET state='processing',claim_token=?,lease_expires_at=?,attempts=attempts+1,updated_at=?
    WHERE id=(SELECT o.id FROM task_checkin_digests o WHERE source_id=? AND state IN ('queued','retryable') AND attempts<5 AND next_attempt_at<=? AND ${ELIGIBLE} ORDER BY created_at,id LIMIT 1)
    AND state IN ('queued','retryable') RETURNING *`,
    )
    .bind(randomToken(), new Date(now.getTime() + 60_000).toISOString(), stamp, sourceId, stamp)
    .first<TaskDigest>();
}
export function readTaskDigestContext(
  db: Db,
  digest: TaskDigest,
  now: Date,
): Promise<TaskDigestContext | null> {
  return db
    .prepare(
      `SELECT s.policy_json,c.discord_user_id,o.notion_user_id FROM task_checkin_digests o
    JOIN task_checkin_sources s ON s.id=o.source_id JOIN task_checkin_consents c ON c.source_id=o.source_id AND c.person_id=o.person_id
    WHERE o.id=? AND o.state='processing' AND o.claim_token=? AND o.lease_expires_at>? AND ${ELIGIBLE}`,
    )
    .bind(digest.id, digest.claim_token, now.toISOString())
    .first<TaskDigestContext>();
}
export async function listTaskDigestTasks(
  db: Db,
  digest: TaskDigest,
  now: Date,
): Promise<{ task_id: string; total_count: number }[]> {
  const rows = await db
    .prepare(
      `SELECT t.task_id,count(*) OVER() AS total_count FROM task_checkin_digests o
    JOIN task_checkin_tasks t ON t.source_id=o.source_id AND t.active=1
    LEFT JOIN task_checkin_cards card ON card.source_id=t.source_id AND card.task_id=t.task_id AND card.person_id IN (${taskPersonOrigins('o.person_id')})
    WHERE o.id=? AND o.claim_token=? AND o.state='processing' AND o.lease_expires_at>? AND ${ELIGIBLE}
    AND EXISTS(SELECT 1 FROM json_each(t.snapshot_json,'$.assigneeIds') a WHERE a.value=o.notion_user_id)
    AND (card.snoozed_until IS NULL OR card.snoozed_until<=?)
    ORDER BY json_extract(t.snapshot_json,'$.dueDate'),t.task_id LIMIT 5`,
    )
    .bind(digest.id, digest.claim_token, now.toISOString(), now.toISOString())
    .all<{ task_id: string; total_count: number }>();
  return rows.results;
}
interface DigestOutcome {
  state: 'confirmed' | 'retryable' | 'held' | 'failed' | 'superseded' | 'deferred';
  reason?: string;
  result?: Record<string, unknown>;
  retryAfterMs?: number;
}
export async function settleTaskDigest(
  db: Db,
  digest: TaskDigest,
  outcome: DigestOutcome,
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE task_checkin_digests AS o SET
    state=CASE WHEN ?='deferred' THEN 'queued' WHEN ?='retryable' AND attempts>=5 THEN 'failed' ELSE ? END,
    attempts=attempts-CASE WHEN ?='deferred' THEN 1 ELSE 0 END,reason=?,result_json=?,next_attempt_at=?,claim_token=NULL,lease_expires_at=NULL,updated_at=?
    WHERE id=? AND state='processing' AND claim_token=? AND lease_expires_at>? AND (?<>'confirmed' OR ${ELIGIBLE})`,
    )
    .bind(
      outcome.state,
      outcome.state,
      outcome.state,
      outcome.state,
      outcome.reason ?? null,
      outcome.result ? JSON.stringify(outcome.result) : null,
      new Date(now.getTime() + Math.max(1000, outcome.retryAfterMs ?? 60_000)).toISOString(),
      now.toISOString(),
      digest.id,
      digest.claim_token,
      now.toISOString(),
      outcome.state,
    )
    .run();
  return result.meta.changes > 0;
}
