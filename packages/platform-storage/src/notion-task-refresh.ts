import { taskMappingMatches } from './notion-task-person-lineage';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from './db';
import { TASK_RECIPIENT_AUTHORITY_SQL as ELIGIBLE } from './notion-task-recipients';
interface RefreshLease {
  source_id: string;
  task_id: string;
  person_id: string;
  generation: number;
  claim_token: string;
  policy_revision?: number;
  consent_revision?: number;
  notion_user_id?: string;
}
export interface TaskCardRefresh extends RefreshLease {
  policy_revision: number;
  consent_revision: number;
  notion_user_id: string;
  discord_user_id: string;
  attempts: number;
  operation_state: string | null;
  operation_kind: string | null;
  operation_reason: string | null;
  policy_json: string;
  snapshot_json: string;
  token: string;
  channel_id: string;
  message_id: string;
  task_revision: string;
  task_active: number;
}
const VIEW = `WITH o AS (SELECT r.rowid AS row_id,r.*,s.revision AS policy_revision,c.revision AS consent_revision,m.notion_user_id,
  c.discord_user_id,s.policy_json,t.snapshot_json,t.revision AS task_revision,t.active AS task_active,
  card.token,card.channel_id,card.message_id,action.state AS operation_state,action.kind AS operation_kind,action.reason AS operation_reason
  FROM task_checkin_card_refreshes r JOIN task_checkin_sources s ON s.id=r.source_id
  JOIN task_checkin_tasks t ON t.source_id=r.source_id AND t.task_id=r.task_id
  JOIN task_checkin_cards card ON card.source_id=r.source_id AND card.task_id=r.task_id AND card.person_id=r.person_id
  JOIN task_checkin_consents c ON c.source_id=r.source_id AND c.person_id=r.person_id
  JOIN task_checkin_mappings m ON m.workspace_id=s.workspace_id AND ${taskMappingMatches('m', 'r.person_id')}
  LEFT JOIN task_checkin_operations action ON action.id=r.operation_id)`;
export function readTaskCardRefresh(
  db: Db,
  lease: RefreshLease,
  now: Date,
): Promise<TaskCardRefresh | null> {
  return db
    .prepare(
      `${VIEW} SELECT * FROM o WHERE source_id=? AND task_id=? AND person_id=? AND generation=?
    AND state='processing' AND claim_token=? AND lease_expires_at>? AND ${ELIGIBLE}
    AND (? IS NULL OR policy_revision=?) AND (? IS NULL OR consent_revision=?) AND (? IS NULL OR notion_user_id=?)`,
    )
    .bind(
      lease.source_id,
      lease.task_id,
      lease.person_id,
      lease.generation,
      lease.claim_token,
      now.toISOString(),
      lease.policy_revision ?? null,
      lease.policy_revision ?? null,
      lease.consent_revision ?? null,
      lease.consent_revision ?? null,
      lease.notion_user_id ?? null,
      lease.notion_user_id ?? null,
    )
    .first<TaskCardRefresh>();
}
export async function claimTaskCardRefresh(
  db: Db,
  sourceId: string,
  now: Date,
  target?: { taskId: string; personId: string },
): Promise<TaskCardRefresh | null> {
  const stamp = now.toISOString();
  await db
    .prepare(
      `UPDATE task_checkin_card_refreshes SET state=CASE WHEN claimed_generation=generation AND attempts>=5 THEN 'failed' ELSE 'retryable' END,
    attempts=CASE WHEN claimed_generation<>generation THEN 0 ELSE attempts END,
    claim_token=NULL,claimed_generation=NULL,lease_expires_at=NULL,reason='edit_unconfirmed',next_attempt_at=?,updated_at=?
    WHERE source_id=? AND state='processing' AND lease_expires_at<=?`,
    )
    .bind(stamp, stamp, sourceId, stamp)
    .run();
  const lease = await db
    .prepare(
      `${VIEW} UPDATE task_checkin_card_refreshes SET state='processing',claimed_generation=generation,claim_token=?,lease_expires_at=?,attempts=attempts+1,updated_at=?
    WHERE rowid=(SELECT o.row_id FROM o WHERE source_id=? AND state IN ('queued','retryable') AND attempts<5 AND next_attempt_at<=?
    AND channel_id IS NOT NULL AND message_id IS NOT NULL
    AND (? IS NULL OR (o.task_id=? AND o.person_id=?)) AND ${ELIGIBLE} ORDER BY updated_at,row_id LIMIT 1)
    AND state IN ('queued','retryable') RETURNING source_id,task_id,person_id,generation,claim_token`,
    )
    .bind(
      randomToken(),
      new Date(now.getTime() + 60_000).toISOString(),
      stamp,
      sourceId,
      stamp,
      target?.taskId ?? null,
      target?.taskId ?? null,
      target?.personId ?? null,
    )
    .first<RefreshLease>();
  return lease ? readTaskCardRefresh(db, lease, now) : null;
}
export async function settleTaskCardRefresh(
  db: Db,
  lease: RefreshLease,
  outcome: {
    state: 'confirmed' | 'retryable' | 'failed' | 'superseded';
    reason?: string;
    retryAfterMs?: number;
  },
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE task_checkin_card_refreshes SET
    state=CASE WHEN generation<>? THEN 'queued' WHEN ?='retryable' AND attempts>=5 THEN 'failed' ELSE ? END,
    reason=CASE WHEN generation<>? THEN NULL ELSE ? END,
    attempts=CASE WHEN generation<>? THEN 0 ELSE attempts END,
    claim_token=NULL,claimed_generation=NULL,lease_expires_at=NULL,
    next_attempt_at=CASE WHEN generation<>? THEN ? ELSE ? END,updated_at=?
    WHERE source_id=? AND task_id=? AND person_id=? AND claim_token=? AND state='processing' AND lease_expires_at>?
    RETURNING generation`,
    )
    .bind(
      lease.generation,
      outcome.state,
      outcome.state,
      lease.generation,
      outcome.reason ?? null,
      lease.generation,
      lease.generation,
      now.toISOString(),
      new Date(now.getTime() + Math.max(1000, outcome.retryAfterMs ?? 60_000)).toISOString(),
      now.toISOString(),
      lease.source_id,
      lease.task_id,
      lease.person_id,
      lease.claim_token,
      now.toISOString(),
    )
    .first<{ generation: number }>();
  return result?.generation === lease.generation;
}
