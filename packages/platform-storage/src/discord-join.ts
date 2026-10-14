import { isDiscordId } from '@lasvegasfortransit/platform-core/discord-identity';
import type { Db } from './db';

interface JoinTarget {
  personId: string;
  discordId: string;
}
const CURRENT = `p.id=? AND p.deleted_at IS NULL AND p.membership_status='member'
  AND NOT EXISTS(SELECT 1 FROM discord_disconnects d JOIN identities i ON i.id=d.identity_record_id WHERE i.person_id=p.id AND i.platform='discord')
  AND (SELECT count(*) FROM identities WHERE person_id=p.id AND platform='discord')=1
  AND EXISTS(SELECT 1 FROM identities WHERE person_id=p.id AND platform='discord'
    AND external_id=? AND link_method IN ('self_linked','staff_confirmed'))`;

export async function discordJoinIsCurrent(db: Db, target: JoinTarget): Promise<boolean> {
  if (!target.personId || target.personId.length > 200 || !isDiscordId(target.discordId))
    return false;
  return Boolean(
    await db
      .prepare(`SELECT 1 FROM people p WHERE ${CURRENT}`)
      .bind(target.personId, target.discordId)
      .first(),
  );
}

/** A new operation also covers reconciliation that finished before the server join. */
export async function queueDiscordJoin(
  db: Db,
  input: JoinTarget & { operationId: string; guildId: string; now: Date },
): Promise<boolean> {
  if (
    !/^[\w:-]{1,120}$/.test(input.operationId) ||
    !isDiscordId(input.guildId) ||
    !isDiscordId(input.discordId) ||
    !input.personId ||
    input.personId.length > 200 ||
    !Number.isFinite(input.now.getTime())
  )
    throw new Error('Invalid Discord join reconciliation');
  const stamp = input.now.toISOString();
  const id = `discord-join:${input.operationId}`;
  const payload = JSON.stringify({ source: 'discord_join', guildId: input.guildId });
  const guard = [input.personId, input.discordId];
  await db.batch([
    db
      .prepare(
        `INSERT INTO reconcile_generations(person_id,target_id,generation)
      SELECT p.id,'person',1 FROM people p WHERE ${CURRENT}
      ON CONFLICT(person_id,target_id) DO NOTHING`,
      )
      .bind(...guard),
    db
      .prepare(
        `INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
      SELECT ?,'person_reconcile',p.id,'person',g.generation,?,?,?,?
      FROM people p JOIN reconcile_generations g ON g.person_id=p.id AND g.target_id='person'
      WHERE ${CURRENT} ON CONFLICT(id) DO NOTHING`,
      )
      .bind(id, payload, stamp, stamp, stamp, ...guard),
  ]);
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM integration_outbox o
    JOIN reconcile_generations g ON g.person_id=o.person_id AND g.target_id=o.target_id AND g.generation=o.generation
    JOIN people p ON p.id=o.person_id
    WHERE o.id=? AND o.kind='person_reconcile' AND o.target_id='person' AND o.payload=? AND ${CURRENT}`,
      )
      .bind(id, payload, ...guard)
      .first(),
  );
}
