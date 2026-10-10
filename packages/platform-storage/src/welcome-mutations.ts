import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { WelcomeClaim, WelcomeMethod } from '@lasvegasfortransit/platform-core/welcome';
import type { MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db, Statement } from './db';
import { MEMBER_SINCE, UNWELCOMED, WELCOME_SCOPE } from './welcome-scope';
import { DAY } from './welcome-queue';
export interface WelcomeMutation {
  kind: 'claim' | 'release' | 'complete';
  personId: string;
  actorId: string;
  operationId: string;
  now: Date;
  method?: WelcomeMethod;
  note?: string;
}
interface Context extends WelcomeMutation {
  claim: WelcomeClaim;
  payload: string;
  stamp: string;
}
const FRESH = `EXISTS(SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=? AND kind=? AND payload=? AND applied_at IS NULL)`;
function fresh(input: Context) {
  return [input.operationId, input.actorId, input.personId, `welcome.${input.kind}`, input.payload];
}
function saveReceipt(db: Db, input: Context): Statement {
  const availability =
    input.kind === 'claim'
      ? `${UNWELCOMED} AND julianday(${MEMBER_SINCE}) BETWEEN julianday(?) AND julianday(?) AND NOT EXISTS(SELECT 1 FROM welcome_claims WHERE person_id=p.id AND expires_at>?)`
      : `EXISTS(SELECT 1 FROM welcome_claims WHERE person_id=p.id AND id=? AND actor_id=? AND expires_at>?)${input.kind === 'complete' ? ` AND ${UNWELCOMED}` : ''}`;
  const params =
    input.kind === 'claim'
      ? [new Date(input.now.getTime() - 60 * DAY).toISOString(), input.stamp, input.stamp]
      : [input.claim.id, input.actorId, input.stamp];
  return db
    .prepare(
      `INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,result,created_at)
    SELECT ?,?,?,?,?,?,? FROM people p WHERE p.id=? AND p.deleted_at IS NULL AND p.membership_status='member'
    AND ${WELCOME_SCOPE} AND ${availability} ON CONFLICT(operation_id) DO NOTHING`,
    )
    .bind(
      input.operationId,
      input.actorId,
      `welcome.${input.kind}`,
      input.personId,
      input.payload,
      JSON.stringify(input.claim),
      input.stamp,
      input.personId,
      input.actorId,
      ...params,
    );
}
function changeClaim(db: Db, input: Context): Statement {
  if (input.kind !== 'claim')
    return db
      .prepare(`DELETE FROM welcome_claims WHERE id=? AND actor_id=? AND ${FRESH}`)
      .bind(input.claim.id, input.actorId, ...fresh(input));
  return db
    .prepare(
      `INSERT INTO welcome_claims(id,person_id,actor_id,claimed_at,expires_at)
    SELECT ?,?,?,?,? WHERE ${FRESH} ON CONFLICT(person_id) DO UPDATE SET id=excluded.id,actor_id=excluded.actor_id,claimed_at=excluded.claimed_at,expires_at=excluded.expires_at`,
    )
    .bind(
      input.claim.id,
      input.personId,
      input.actorId,
      input.stamp,
      input.claim.expiresAt,
      ...fresh(input),
    );
}
function recordHistory(db: Db, input: Context): Statement[] {
  const writes = [
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,operation_id,occurred_at)
    SELECT ?,?,?,?,?,? WHERE ${FRESH}`,
      )
      .bind(
        ulid(),
        input.actorId,
        `welcome.${input.kind}`,
        input.personId,
        input.operationId,
        input.stamp,
        ...fresh(input),
      ),
  ];
  if (input.kind === 'complete')
    writes.push(
      db
        .prepare(
          `INSERT INTO engagement_events(id,person_id,type,occurred_at,source,reference,details,created_at)
    SELECT ?,?,'welcomed',?,'staff',?,?,? WHERE ${FRESH}`,
        )
        .bind(
          ulid(),
          input.personId,
          input.stamp,
          input.claim.id,
          JSON.stringify({ actorId: input.actorId, method: input.method, note: input.note }),
          input.stamp,
          ...fresh(input),
        ),
    );
  return writes;
}
export async function mutateWelcome(
  db: Db,
  input: WelcomeMutation,
): Promise<MutationResult<WelcomeClaim>> {
  const payload = JSON.stringify({ method: input.method, note: input.note });
  const prior = await db
    .prepare(
      `SELECT op.actor_id,op.kind,op.target_id,op.payload,op.result,op.applied_at FROM staff_operations op JOIN people p ON p.id=op.target_id WHERE operation_id=? AND p.deleted_at IS NULL AND p.membership_status='member' AND ${WELCOME_SCOPE}`,
    )
    .bind(input.operationId, input.actorId)
    .first<{
      actor_id: string;
      kind: string;
      target_id: string;
      payload: string;
      result: string;
      applied_at: string | null;
    }>();
  if (prior)
    return prior.actor_id === input.actorId &&
      prior.kind === `welcome.${input.kind}` &&
      prior.target_id === input.personId &&
      prior.payload === payload &&
      prior.applied_at
      ? { kind: 'ok', value: JSON.parse(prior.result) as WelcomeClaim }
      : { kind: 'conflict' };
  const stamp = input.now.toISOString();
  const claim =
    input.kind === 'claim'
      ? {
          id: ulid(),
          personId: input.personId,
          actorId: input.actorId,
          claimedAt: stamp,
          expiresAt: new Date(input.now.getTime() + 7 * DAY).toISOString(),
        }
      : await db
          .prepare(
            `SELECT id,person_id AS personId,actor_id AS actorId,claimed_at AS claimedAt,expires_at AS expiresAt FROM welcome_claims WHERE person_id=? AND actor_id=? AND expires_at>?`,
          )
          .bind(input.personId, input.actorId, stamp)
          .first<WelcomeClaim>();
  if (!claim) return { kind: 'conflict' };
  const context = { ...input, payload, stamp, claim };
  await db.batch([
    saveReceipt(db, context),
    changeClaim(db, context),
    ...recordHistory(db, context),
    db
      .prepare(`UPDATE staff_operations SET applied_at=? WHERE operation_id=? AND ${FRESH}`)
      .bind(stamp, input.operationId, ...fresh(context)),
  ]);
  const applied = await db
    .prepare(
      `SELECT op.result FROM staff_operations op JOIN people p ON p.id=op.target_id WHERE operation_id=? AND actor_id=? AND target_id=? AND kind=? AND payload=? AND applied_at IS NOT NULL AND p.deleted_at IS NULL AND p.membership_status='member' AND ${WELCOME_SCOPE}`,
    )
    .bind(...fresh(context), input.actorId)
    .first<{ result: string }>();
  return applied
    ? { kind: 'ok', value: JSON.parse(applied.result) as WelcomeClaim }
    : { kind: 'conflict' };
}
