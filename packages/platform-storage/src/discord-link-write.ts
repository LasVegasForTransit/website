import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import type { DiscordIdentity } from '@lasvegasfortransit/platform-core/discord-identity';
import type { Db, SqlValue, Statement } from './db';
import type { DiscordLinkClaim } from './discord-link';
interface LinkInput {
  claim: DiscordLinkClaim;
  identity: DiscordIdentity;
  now: Date;
}
interface Guard {
  sql: string;
  values: SqlValue[];
}
function guard(input: LinkInput): Guard {
  const { claim, identity, now } = input;
  return {
    sql: `EXISTS(SELECT 1 FROM discord_link_states f JOIN sessions s ON s.id_hash=f.session_hash JOIN people p ON p.id=f.person_id
      WHERE f.state_hash=? AND f.claim_token=? AND f.person_id=? AND f.session_hash=? AND f.origin_url=?
      AND f.claimed_at IS NOT NULL AND f.completed_at IS NULL AND f.expires_at>? AND s.expires_at>?
      AND s.person_id=p.id AND p.deleted_at IS NULL AND p.membership_status='member')
      AND (SELECT count(*) FROM identities WHERE platform='discord' AND person_id=?)<=1
      AND NOT EXISTS(SELECT 1 FROM identities WHERE platform='discord' AND person_id=? AND external_id<>?)
      AND NOT EXISTS(SELECT 1 FROM identities WHERE platform='discord' AND external_id=? AND person_id<>?)`,
    values: [
      claim.stateHash,
      claim.claimToken,
      claim.personId,
      claim.sessionHash,
      claim.origin,
      now.toISOString(),
      now.toISOString(),
      claim.personId,
      claim.personId,
      identity.id,
      identity.id,
      claim.personId,
    ],
  };
}
function writer(db: Db, input: LinkInput) {
  const eligible = guard(input);
  return (sql: string, values: SqlValue[] = []): Statement =>
    db.prepare(`${sql} AND ${eligible.sql}`).bind(...values, ...eligible.values);
}
function identityWrites(db: Db, input: LinkInput): Statement[] {
  const write = writer(db, input),
    { claim, identity, now } = input,
    stamp = now.toISOString();
  return [
    write(
      `INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at)
      SELECT ?,?,'discord',?,?,'self_linked',?,? WHERE NOT EXISTS(SELECT 1 FROM identities WHERE platform='discord' AND external_id=?)`,
      [ulid(), claim.personId, identity.id, stamp, stamp, stamp, identity.id],
    ),
    write(
      "UPDATE identities SET link_method='self_linked',updated_at=? WHERE platform='discord' AND external_id=? AND person_id=?",
      [stamp, identity.id, claim.personId],
    ),
    db
      .prepare(
        `INSERT INTO discord_identity_profiles(identity_record_id,username,display_name,avatar,verified_at)
      SELECT id,?,?,?,? FROM identities WHERE platform='discord' AND external_id=? AND person_id=? AND ${guard(input).sql}
      ON CONFLICT(identity_record_id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,avatar=excluded.avatar,verified_at=excluded.verified_at`,
      )
      .bind(
        identity.username,
        identity.displayName,
        identity.avatar,
        stamp,
        identity.id,
        claim.personId,
        ...guard(input).values,
      ),
  ];
}
function queuedWrites(db: Db, input: LinkInput): Statement[] {
  const write = writer(db, input),
    { claim, now } = input,
    eligible = guard(input),
    stamp = now.toISOString();
  return [
    db
      .prepare(
        `INSERT INTO reconcile_generations(person_id,target_id,generation) SELECT ?,'person',1 WHERE ${eligible.sql}
      ON CONFLICT(person_id,target_id) DO UPDATE SET generation=generation+1`,
      )
      .bind(claim.personId, ...eligible.values),
    write(
      "UPDATE reconcile_generations SET generation=generation+1 WHERE person_id=? AND target_id<>'person'",
      [claim.personId],
    ),
    write(
      "UPDATE integration_outbox SET state='superseded',updated_at=? WHERE person_id=? AND state IN ('queued','running','retry')",
      [stamp, claim.personId],
    ),
    write(
      `INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
      SELECT ? || ':' || target_id,CASE WHEN target_id='person' THEN 'person_reconcile' ELSE 'committee_reconcile' END,person_id,target_id,generation,?,?,?,?
      FROM reconcile_generations WHERE person_id=?`,
      [ulid(), JSON.stringify({ source: 'discord_link' }), stamp, stamp, stamp, claim.personId],
    ),
  ];
}
export async function completeDiscordLink(db: Db, input: LinkInput): Promise<boolean> {
  const write = writer(db, input),
    { claim, now } = input;
  const completionToken = randomToken(),
    operationId = `discord-link:${claim.stateHash}`;
  await db.batch([
    ...identityWrites(db, input),
    ...queuedWrites(db, input),
    write(
      `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at)
      SELECT ?,?,'identity.discord_link',?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM staff_audits WHERE operation_id=? AND action='identity.discord_link')`,
      [
        ulid(),
        claim.personId,
        claim.personId,
        JSON.stringify({ completionToken }),
        operationId,
        now.toISOString(),
        operationId,
      ],
    ),
    write('UPDATE discord_link_states SET completed_at=? WHERE state_hash=?', [
      now.toISOString(),
      claim.stateHash,
    ]),
  ]);
  return Boolean(
    await db
      .prepare(
        "SELECT 1 FROM staff_audits WHERE operation_id=? AND action='identity.discord_link' AND json_extract(details,'$.completionToken')=?",
      )
      .bind(operationId, completionToken)
      .first(),
  );
}
