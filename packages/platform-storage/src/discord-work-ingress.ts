import type { Db } from './db';
import { workScopeKey, type WorkConversation, type WorkOperationInput } from './discord-work-types';
export async function acceptWorkMessages(
  db: Db,
  input: { previous: WorkConversation; next: WorkConversation; operations: WorkOperationInput[] },
  now: Date,
): Promise<'accepted' | 'stale'> {
  const { previous: p, next: n, operations } = input,
    key = workScopeKey(p.scope),
    stamp = now.toISOString();
  const guard = `EXISTS(SELECT 1 FROM discord_work_conversations c JOIN discord_project_homes h ON h.id=c.home_id WHERE c.id=? AND c.scope_key=? AND c.generation=? AND c.state='active' AND h.state='active'
  AND json_extract(c.data_json,'$.cursorId')=? AND json_extract(c.data_json,'$.windowBeforeId') IS ? AND json_extract(c.data_json,'$.windowUpperId') IS ?)`;
  const guardValues = [p.id, key, p.generation, p.cursorId, p.windowBeforeId, p.windowUpperId];
  const writes = operations.map((o) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO discord_work_operations
  (id,scope_key,home_id,conversation_id,generation,kind,source_key,actor_person_id,actor_discord_id,grant_version,original_author_id,payload_json,state,next_attempt_at,created_at,updated_at)
  SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'queued',?,?,? WHERE ${guard}`,
      )
      .bind(
        o.id,
        key,
        o.homeId,
        o.conversationId,
        o.generation,
        o.kind,
        o.sourceKey,
        o.actorPersonId,
        o.actorDiscordId,
        o.grantVersion,
        o.originalAuthorId,
        JSON.stringify(o.payload),
        stamp,
        stamp,
        stamp,
        ...guardValues,
      ),
  );
  writes.push(
    db
      .prepare(
        `UPDATE discord_work_conversations SET data_json=?,next_attempt_at=?,updated_at=? WHERE id=? AND ${guard}`,
      )
      .bind(
        JSON.stringify(n),
        new Date(now.getTime() + 60_000).toISOString(),
        stamp,
        p.id,
        ...guardValues,
      ),
  );
  const result = await db.batch(writes);
  const last = result[result.length - 1];
  if (
    !last ||
    typeof last !== 'object' ||
    !('meta' in last) ||
    !last.meta ||
    typeof last.meta !== 'object' ||
    !('changes' in last.meta)
  )
    return 'stale';
  return Number(last.meta.changes) > 0 ? 'accepted' : 'stale';
}
