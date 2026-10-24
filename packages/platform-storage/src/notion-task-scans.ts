import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db, SqlValue } from './db';
import type { TaskSnapshotInput } from './notion-task-checkins';
import { TASK_SNAPSHOT_UPDATE } from './notion-task-snapshot-sql';

export interface TaskScan {
  source_id: string;
  scan_id: string;
  policy_revision: number;
  cursor: string | null;
  claim_token: string;
}
export type TaskScanSnapshot = Omit<TaskSnapshotInput, 'sourceId' | 'scanId'>;

export function claimTaskScan(db: Db, sourceId: string, now: Date): Promise<TaskScan | null> {
  const stamp = now.toISOString();
  return db
    .prepare(
      `INSERT INTO task_checkin_scans
    (source_id,scan_id,policy_revision,state,claim_token,lease_expires_at,next_attempt_at,updated_at)
    SELECT id,?,revision,'scanning',?,?,?,? FROM task_checkin_sources WHERE id=?
    ON CONFLICT(source_id) DO UPDATE SET
    scan_id=CASE WHEN state<>'scanning' OR policy_revision<>excluded.policy_revision THEN excluded.scan_id ELSE scan_id END,
    cursor=CASE WHEN state<>'scanning' OR policy_revision<>excluded.policy_revision THEN NULL ELSE cursor END,
    policy_revision=excluded.policy_revision,state='scanning',claim_token=excluded.claim_token,
    lease_expires_at=excluded.lease_expires_at,updated_at=excluded.updated_at,reason=NULL
    WHERE next_attempt_at<=? AND (claim_token IS NULL OR lease_expires_at<=?) RETURNING *`,
    )
    .bind(
      randomToken(),
      randomToken(),
      new Date(now.getTime() + 60_000).toISOString(),
      stamp,
      stamp,
      sourceId,
      stamp,
      stamp,
    )
    .first<TaskScan>();
}

const GUARD = `EXISTS(SELECT 1 FROM task_checkin_scans c JOIN task_checkin_sources s ON s.id=c.source_id
  WHERE c.source_id=? AND c.scan_id=? AND c.claim_token=? AND c.lease_expires_at>?
  AND c.policy_revision=s.revision AND c.state='scanning')`;
function guardValues(claim: TaskScan, now: Date): SqlValue[] {
  return [claim.source_id, claim.scan_id, claim.claim_token, now.toISOString()];
}
/** Only a complete successful pass can invalidate previously unseen tasks. */
export async function completeTaskScanPage(
  db: Db,
  claim: TaskScan,
  page: { tasks: TaskScanSnapshot[]; nextCursor: string | null },
  now: Date,
): Promise<boolean> {
  const { tasks, nextCursor } = page;
  if (tasks.length > 20) throw new Error('Task scan page exceeds the database batch budget');
  const guard = guardValues(claim, now);
  const writes = tasks.map((task) =>
    db
      .prepare(
        `INSERT INTO task_checkin_tasks
    (source_id,task_id,revision,source_edited_at,active,snapshot_json,seen_scan_id,updated_at,inactive_since)
    SELECT ?,?,?,?,?,?,?,?,? WHERE ${GUARD}
    ON CONFLICT(source_id,task_id) DO UPDATE SET ${TASK_SNAPSHOT_UPDATE}`,
      )
      .bind(
        claim.source_id,
        task.taskId,
        task.revision,
        task.sourceEditedAt,
        Number(task.active),
        JSON.stringify(task.snapshot),
        claim.scan_id,
        now.toISOString(),
        task.active ? null : now.toISOString(),
        ...guard,
      ),
  );
  if (nextCursor === null)
    writes.push(
      db
        .prepare(
          `UPDATE task_checkin_tasks SET active=0,inactive_since=coalesce(inactive_since,?),
    revision=revision||':removed:'||?,updated_at=? WHERE source_id=? AND active=1
    AND (seen_scan_id IS NULL OR seen_scan_id<>?) AND ${GUARD}`,
        )
        .bind(
          now.toISOString(),
          claim.scan_id,
          now.toISOString(),
          claim.source_id,
          claim.scan_id,
          ...guard,
        ),
    );
  writes.push(
    db
      .prepare(
        `UPDATE task_checkin_scans SET cursor=?,state=?,claim_token=NULL,lease_expires_at=NULL,
    last_completed_at=CASE WHEN ? IS NULL THEN ? ELSE last_completed_at END,next_attempt_at=?,updated_at=?
    WHERE source_id=? AND ${GUARD}`,
      )
      .bind(
        nextCursor,
        nextCursor === null ? 'complete' : 'scanning',
        nextCursor,
        now.toISOString(),
        new Date(now.getTime() + (nextCursor === null ? 900_000 : 0)).toISOString(),
        now.toISOString(),
        claim.source_id,
        ...guard,
      ),
  );
  const results = await db.batch(writes);
  const last = results.at(-1) as { meta: { changes: number } };
  return last.meta.changes === 1;
}

export async function failTaskScan(
  db: Db,
  claim: TaskScan,
  failure: { reason: string; retryAfterMs?: number },
  now: Date,
): Promise<void> {
  const { reason, retryAfterMs = 60_000 } = failure;
  await db
    .prepare(
      `UPDATE task_checkin_scans SET reason=?,claim_token=NULL,lease_expires_at=NULL,
    next_attempt_at=?,updated_at=? WHERE source_id=? AND claim_token=?`,
    )
    .bind(
      reason,
      new Date(now.getTime() + Math.max(1000, retryAfterMs)).toISOString(),
      now.toISOString(),
      claim.source_id,
      claim.claim_token,
    )
    .run();
}
