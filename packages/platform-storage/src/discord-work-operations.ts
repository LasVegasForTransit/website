import type { Db } from './db';
import {
  workScopeKey,
  type WorkScope,
  type WorkOperation,
  type WorkOperationInput,
  type WorkOutcome,
} from './discord-work-types';
export type { WorkOperation, WorkOperationInput, WorkOutcome } from './discord-work-types';
const CURRENT = `((conversation_id IS NOT NULL AND EXISTS(SELECT 1 FROM discord_work_conversations c JOIN discord_project_homes h ON h.id=c.home_id
  WHERE c.id=o.conversation_id AND c.scope_key=o.scope_key AND c.generation=o.generation AND c.state='active' AND h.state='active'))
  OR (conversation_id IS NULL AND home_id IS NOT NULL AND EXISTS(SELECT 1 FROM discord_project_homes h WHERE h.id=o.home_id AND h.scope_key=o.scope_key AND h.generation=o.generation AND h.state IN ('active','preview')))
  OR (conversation_id IS NULL AND home_id IS NULL AND kind='provision'))`;
export async function enqueueWorkOperation(
  db: Db,
  input: WorkOperationInput,
  now: Date,
): Promise<'queued' | 'duplicate' | 'stale'> {
  const key = workScopeKey(input.scope),
    stamp = now.toISOString();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO discord_work_operations
    (id,scope_key,home_id,conversation_id,generation,kind,source_key,actor_person_id,actor_discord_id,grant_version,original_author_id,payload_json,state,expires_at,next_attempt_at,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ?=1 OR EXISTS(SELECT 1 FROM discord_work_conversations c JOIN discord_project_homes h ON h.id=c.home_id WHERE c.id=? AND c.scope_key=? AND c.generation=? AND c.state='active' AND h.state='active')
    OR (? IS NULL AND (? IS NULL OR EXISTS(SELECT 1 FROM discord_project_homes h WHERE h.id=? AND h.scope_key=? AND h.generation=? AND h.state IN ('active','preview'))))`,
    )
    .bind(
      input.id,
      key,
      input.homeId,
      input.conversationId,
      input.generation,
      input.kind,
      input.sourceKey,
      input.actorPersonId,
      input.actorDiscordId,
      input.grantVersion,
      input.originalAuthorId,
      JSON.stringify(input.payload),
      input.preview ? 'preview' : 'queued',
      input.preview ? new Date(now.getTime() + 600_000).toISOString() : null,
      stamp,
      stamp,
      stamp,
      Number(Boolean(input.preview)),
      input.conversationId,
      key,
      input.generation,
      input.conversationId,
      input.homeId,
      input.homeId,
      key,
      input.generation,
    )
    .run();
  if (result.meta.changes) return 'queued';
  return (await db
    .prepare('SELECT 1 FROM discord_work_operations WHERE scope_key=? AND source_key=?')
    .bind(key, input.sourceKey)
    .first())
    ? 'duplicate'
    : 'stale';
}
export async function readWorkOperation(
  db: Db,
  scope: WorkScope,
  id: string,
): Promise<WorkOperation | null> {
  return db
    .prepare('SELECT * FROM discord_work_operations WHERE scope_key=? AND id=?')
    .bind(workScopeKey(scope), id)
    .first<WorkOperation>();
}
export async function consumeWorkPreview(
  db: Db,
  input: { scope: WorkScope; id: string; actorId: string },
  now: Date,
): Promise<WorkOperation | null> {
  const { scope, id, actorId } = input;
  return db
    .prepare(
      "UPDATE discord_work_operations SET state='superseded',reason='preview_consumed',updated_at=? WHERE scope_key=? AND id=? AND actor_discord_id=? AND state='preview' AND expires_at>? RETURNING *",
    )
    .bind(now.toISOString(), workScopeKey(scope), id, actorId, now.toISOString())
    .first<WorkOperation>();
}
export async function claimWorkOperation(
  db: Db,
  scope: WorkScope,
  now: Date,
): Promise<WorkOperation | null> {
  const key = workScopeKey(scope),
    stamp = now.toISOString();
  await db
    .prepare(
      "UPDATE discord_work_operations SET state='held',reason='unconfirmed_effect' WHERE scope_key=? AND state='processing' AND lease_expires_at<=?",
    )
    .bind(key, stamp)
    .run();
  await db
    .prepare(
      `UPDATE discord_work_operations AS o SET state='superseded',reason='link_changed' WHERE scope_key=? AND state IN ('queued','retryable') AND NOT ${CURRENT}`,
    )
    .bind(key)
    .run();
  await db
    .prepare(
      "UPDATE discord_work_operations SET state='failed',reason='retry_limit' WHERE scope_key=? AND state IN ('queued','retryable') AND attempts>=5",
    )
    .bind(key)
    .run();
  return db
    .prepare(
      `UPDATE discord_work_operations SET state='processing',claim_token=?,lease_expires_at=?,attempts=attempts+1,updated_at=? WHERE id=(
    SELECT id FROM discord_work_operations o WHERE scope_key=? AND state IN ('queued','retryable') AND next_attempt_at<=? AND attempts<5 AND ${CURRENT}
    AND (json_extract(payload_json,'$.automatic') IS NOT 1 OR EXISTS(SELECT 1 FROM discord_work_conversations c WHERE c.id=o.conversation_id AND json_extract(c.data_json,'$.windowUpperId') IS NULL))
    AND (kind<>'comment' OR NOT EXISTS(SELECT 1 FROM discord_work_operations earlier WHERE earlier.scope_key=o.scope_key AND earlier.conversation_id=o.conversation_id AND earlier.kind='comment' AND earlier.state IN ('held','processing','queued','retryable') AND (coalesce(json_extract(earlier.payload_json,'$.message.createdAt'),earlier.created_at),earlier.source_key)<(coalesce(json_extract(o.payload_json,'$.message.createdAt'),o.created_at),o.source_key)))
    ORDER BY coalesce(json_extract(payload_json,'$.message.createdAt'),created_at),length(json_extract(payload_json,'$.message.id')),json_extract(payload_json,'$.message.id'),id LIMIT 1) RETURNING *`,
    )
    .bind(crypto.randomUUID(), new Date(now.getTime() + 60_000).toISOString(), stamp, key, stamp)
    .first<WorkOperation>();
}
export async function settleWorkOperation(
  db: Db,
  lease: { id: string; token: string },
  outcome: WorkOutcome,
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE discord_work_operations SET state=?,reason=?,result_json=coalesce(?,result_json),next_attempt_at=?,claim_token=NULL,lease_expires_at=NULL,updated_at=?
    WHERE id=? AND claim_token=? AND state='processing' AND lease_expires_at>?`,
    )
    .bind(
      outcome.state,
      outcome.reason ?? null,
      outcome.providerIds ? JSON.stringify(outcome.providerIds) : null,
      new Date(now.getTime() + Math.max(1000, outcome.retryAfterMs ?? 60_000)).toISOString(),
      now.toISOString(),
      lease.id,
      lease.token,
      now.toISOString(),
    )
    .run();
  return result.meta.changes > 0;
}
