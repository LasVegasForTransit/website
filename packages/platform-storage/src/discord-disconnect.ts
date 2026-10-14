import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { digestToken, randomToken } from '@lasvegasfortransit/platform-core/random-token';
import type { AuthEnv } from './auth';
import type { Db } from './db';
import { discordLinkOrigin, discordSessionHash } from './discord-link';
import { discordSyncGuard, type DiscordSyncWrite } from './discord-sync-store';

const ELIGIBLE = `EXISTS(SELECT 1 FROM sessions s JOIN people p ON p.id=s.person_id
  JOIN identities i ON i.person_id=p.id WHERE s.id_hash=? AND s.expires_at>?
  AND p.deleted_at IS NULL AND i.id=? AND i.platform='discord'
  AND i.link_method IN ('self_linked','staff_confirmed')
  AND (SELECT count(*) FROM identities WHERE person_id=p.id AND platform='discord')=1)`;

export async function discordDisconnectTarget(
  env: AuthEnv,
  sessionToken: string,
  origin: string,
  now: Date = new Date(),
): Promise<{ personId: string; identityRecordId: string; disconnecting: boolean } | null> {
  if (
    !discordLinkOrigin(origin) ||
    !/^[\w-]{43}$/.test(sessionToken) ||
    !Number.isFinite(now.getTime())
  )
    return null;
  const target = await env.PLATFORM_DB.prepare(
    `SELECT i.person_id AS personId,i.id AS identityRecordId,EXISTS(SELECT 1 FROM discord_disconnects WHERE identity_record_id=i.id) AS disconnecting FROM identities i
    JOIN sessions s ON s.person_id=i.person_id JOIN people p ON p.id=i.person_id
    WHERE s.id_hash=? AND s.expires_at>? AND p.deleted_at IS NULL
    AND i.platform='discord' AND i.link_method IN ('self_linked','staff_confirmed')
    AND (SELECT count(*) FROM identities WHERE person_id=p.id AND platform='discord')=1`,
  )
    .bind(await discordSessionHash(env, sessionToken), now.toISOString())
    .first<{ personId: string; identityRecordId: string; disconnecting: number }>();
  return target ? { ...target, disconnecting: Boolean(target.disconnecting) } : null;
}

interface DisconnectInput {
  sessionToken: string;
  origin: string;
  identityRecordId: string;
  operationId: string;
  now: Date;
}
export async function beginDiscordDisconnect(
  env: AuthEnv,
  input: DisconnectInput,
): Promise<{ personId: string; operationId: string } | null> {
  if (!/^[\w:-]{1,120}$/.test(input.operationId)) return null;
  const target = await discordDisconnectTarget(env, input.sessionToken, input.origin, input.now);
  if (target?.identityRecordId !== input.identityRecordId) return null;
  const db = env.PLATFORM_DB;
  const stamp = input.now.toISOString();
  const eligible = [
    await discordSessionHash(env, input.sessionToken),
    stamp,
    input.identityRecordId,
  ];
  const read = async () =>
    await db
      .prepare(
        `SELECT ? AS personId,operation_id AS operationId FROM discord_disconnects
    WHERE identity_record_id=? AND ${ELIGIBLE}`,
      )
      .bind(target.personId, input.identityRecordId, ...eligible)
      .first<{ personId: string; operationId: string }>();
  const existing = await read();
  if (existing) return existing;
  const guard = `EXISTS(SELECT 1 FROM discord_disconnects WHERE identity_record_id=? AND operation_id=?) AND ${ELIGIBLE}`;
  const values = [input.identityRecordId, input.operationId, ...eligible];
  await db.batch([
    db
      .prepare(
        `INSERT INTO discord_disconnects(identity_record_id,operation_id,requested_at)
      SELECT ?,?,? WHERE ${ELIGIBLE} ON CONFLICT DO NOTHING`,
      )
      .bind(input.identityRecordId, input.operationId, stamp, ...eligible),
    db
      .prepare(`DELETE FROM discord_link_states WHERE person_id=? AND ${guard}`)
      .bind(target.personId, ...values),
    db
      .prepare(
        `INSERT INTO reconcile_generations(person_id,target_id,generation)
      SELECT ?,'person',1 WHERE ${guard} ON CONFLICT(person_id,target_id) DO UPDATE SET generation=generation+1`,
      )
      .bind(target.personId, ...values),
    db
      .prepare(
        `UPDATE reconcile_generations SET generation=generation+1 WHERE person_id=? AND target_id<>'person' AND ${guard}`,
      )
      .bind(target.personId, ...values),
    db
      .prepare(
        `UPDATE integration_outbox SET state='superseded',updated_at=? WHERE person_id=? AND state IN ('queued','running','retry') AND ${guard}`,
      )
      .bind(stamp, target.personId, ...values),
    db
      .prepare(
        `INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
      SELECT CASE WHEN target_id='person' THEN ? ELSE ?||':'||target_id END,
      CASE WHEN target_id='person' THEN 'person_reconcile' ELSE 'committee_reconcile' END,person_id,target_id,generation,?,?,?,? FROM reconcile_generations
      WHERE person_id=? AND ${guard}`,
      )
      .bind(
        input.operationId,
        input.operationId,
        JSON.stringify({ source: 'discord_disconnect' }),
        stamp,
        stamp,
        stamp,
        target.personId,
        ...values,
      ),
  ]);
  return await read();
}

/** Unlink only after the guarded reconciler has read back that access ended. */
export async function finishDiscordDisconnect(db: Db, input: DiscordSyncWrite): Promise<boolean> {
  const intent = input.plan.disconnectOperationId;
  if (
    !intent ||
    input.member === undefined ||
    input.plan.desiredRoleIds.length ||
    (input.member &&
      (input.member.user.id !== input.plan.identityId ||
        input.member.roles.some((id) => input.plan.managedRoleIds.includes(id))))
  )
    return false;
  const current = discordSyncGuard(input);
  const guard = `${current.sql} AND EXISTS(SELECT 1 FROM discord_disconnects WHERE identity_record_id=? AND operation_id=?)
    AND EXISTS(SELECT 1 FROM provider_operation_receipts WHERE operation_id=? AND provider='discord' AND state='done'
      AND revision_hash=? AND lease_token=? AND observed_at<=? AND expires_at>?)`;
  const values = [
    ...current.values,
    input.plan.identityRecordId,
    intent,
    input.operationId,
    await digestToken(input.plan.revision),
    input.lease.token,
    input.now.toISOString(),
    input.now.toISOString(),
  ];
  const completion = randomToken();
  await db.batch([
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at)
      SELECT ?,?,'identity.discord_disconnect',?,?,?,? WHERE ${guard}`,
      )
      .bind(
        ulid(),
        input.plan.personId,
        input.plan.personId,
        JSON.stringify({ completionToken: completion }),
        intent,
        input.now.toISOString(),
        ...values,
      ),
    db
      .prepare(
        `DELETE FROM access_observations WHERE provider='discord' AND person_id=? AND identity_id=? AND ${guard}`,
      )
      .bind(input.plan.personId, input.plan.identityId, ...values),
    db
      .prepare(`DELETE FROM identities WHERE id=? AND ${guard}`)
      .bind(input.plan.identityRecordId, ...values),
  ]);
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM staff_audits WHERE operation_id=? AND action='identity.discord_disconnect'
    AND json_extract(details,'$.completionToken')=? AND NOT EXISTS(SELECT 1 FROM identities WHERE id=?)`,
      )
      .bind(intent, completion, input.plan.identityRecordId)
      .first(),
  );
}
