import type { AccessFailure } from '@lasvegasfortransit/platform-core/access';
import { randomToken, digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db, Statement, SqlValue } from './db';
import type { DiscordPlan } from './discord-plan';
import { accessObservationWrite } from './access-observations';
import { PERSON_OPERATION_ELIGIBLE } from './outbox';
export interface DiscordLease {
  guildId: string;
  identityId: string;
  token: string;
}
export interface DiscordObservedMember {
  user: { id: string; username: string; displayName: string | null; avatar: string | null };
  roles: string[];
  pending: boolean;
  nickname: string | null;
}
export interface DiscordSyncWrite {
  operationId: string;
  plan: DiscordPlan;
  lease: DiscordLease;
  now: Date;
  member?: DiscordObservedMember | null;
  failure?: AccessFailure;
  retryAfterMs?: number;
}
const IDENTITY_CURRENT = `EXISTS(SELECT 1 FROM reconciliation_people p JOIN identities i ON i.person_id=p.id WHERE p.id=? AND p.deleted_at IS ? AND i.id=? AND i.platform='discord' AND i.external_id=? AND i.external_email IS ?
  AND i.link_method IN ('self_linked','staff_confirmed')
  AND (SELECT count(*) FROM identities WHERE person_id=p.id AND platform='discord')=1
  AND (CASE WHEN p.deleted_at IS NULL AND p.membership_status='member' THEN 1 ELSE 0 END)=?
  AND coalesce((SELECT generation FROM reconcile_generations WHERE person_id=p.id AND target_id='person'),0)=?)`;
const LEASE_CURRENT = `EXISTS(SELECT 1 FROM provider_account_leases WHERE provider='discord' AND context_id=? AND identity_id=? AND token=? AND expires_at>?)`;
const JOB_CURRENT = `EXISTS(SELECT 1 FROM integration_outbox o JOIN reconcile_generations g ON g.person_id=o.person_id AND g.target_id=o.target_id AND g.generation=o.generation
  JOIN reconciliation_people p ON p.id=o.person_id WHERE o.id=? AND o.person_id=? AND o.kind IN ('person_reconcile','committee_reconcile') AND o.state IN ('queued','running','retry') AND ${PERSON_OPERATION_ELIGIBLE})`;
function identityValues(plan: DiscordPlan): SqlValue[] {
  const person = plan.targets.find((target) => target.targetId === 'person');
  if (!person) throw new Error('Invalid Discord plan');
  return [
    plan.personId,
    plan.deletedAt,
    plan.identityRecordId,
    plan.identityId,
    plan.identityEmail,
    Number(person.expectedAccess),
    person.generation,
  ];
}
function leaseValues(lease: DiscordLease, now: Date): SqlValue[] {
  return [lease.guildId, lease.identityId, lease.token, now.toISOString()];
}
function guards(input: DiscordSyncWrite): SqlValue[] {
  return [
    ...identityValues(input.plan),
    ...leaseValues(input.lease, input.now),
    input.operationId,
    input.plan.personId,
  ];
}
const CURRENT = `${IDENTITY_CURRENT} AND ${LEASE_CURRENT} AND ${JOB_CURRENT}`;
export function discordSyncGuard(input: DiscordSyncWrite) {
  return { sql: CURRENT, values: guards(input) };
}
export async function claimDiscordLease(
  db: Db,
  plan: DiscordPlan,
  now: Date = new Date(),
): Promise<DiscordLease | null> {
  const lease = { guildId: plan.guildId, identityId: plan.identityId, token: randomToken() };
  const result = await db
    .prepare(
      `INSERT INTO provider_account_leases(provider,context_id,identity_id,token,expires_at)
    SELECT 'discord',?,?,?,? WHERE ${IDENTITY_CURRENT} ON CONFLICT(provider,context_id,identity_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE provider_account_leases.expires_at<=?`,
    )
    .bind(
      lease.guildId,
      lease.identityId,
      lease.token,
      new Date(now.getTime() + 30_000).toISOString(),
      ...identityValues(plan),
      now.toISOString(),
    )
    .run();
  return result.meta.changes === 1 ? lease : null;
}
export async function renewDiscordLease(
  db: Db,
  lease: DiscordLease,
  now: Date = new Date(),
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE provider_account_leases SET expires_at=? WHERE provider='discord' AND context_id=? AND identity_id=? AND token=? AND expires_at>?`,
    )
    .bind(new Date(now.getTime() + 30_000).toISOString(), ...leaseValues(lease, now))
    .run();
  return result.meta.changes === 1;
}
export async function releaseDiscordLease(db: Db, lease: DiscordLease): Promise<void> {
  await db
    .prepare(
      "DELETE FROM provider_account_leases WHERE provider='discord' AND context_id=? AND identity_id=? AND token=?",
    )
    .bind(lease.guildId, lease.identityId, lease.token)
    .run();
}
function observationWrites(db: Db, input: DiscordSyncWrite): Statement[] {
  if (input.plan.deletedAt !== null) return [];
  return input.plan.targets
    .filter((target) => target.current)
    .flatMap((target) => {
      const statement = accessObservationWrite(
        db,
        {
          personId: input.plan.personId,
          targetId: target.targetId,
          provider: 'discord',
          identityId: input.plan.identityId,
          identityEmail: input.plan.identityEmail,
          resourceId: target.resourceId,
          contextId: input.plan.guildId,
          generation: target.generation,
          expectedAccess: target.expectedAccess,
          state: input.failure
            ? 'unknown'
            : input.member?.roles.includes(target.resourceId)
              ? 'granted'
              : 'absent',
          ...(input.failure ? { failure: input.failure } : {}),
          observedAt: input.now.toISOString(),
          expiresAt: new Date(input.now.getTime() + 300_000).toISOString(),
        },
        input.now,
        { sql: CURRENT, values: guards(input) },
      );
      return statement ? [statement] : [];
    });
}
function profileWrite(db: Db, input: DiscordSyncWrite): Statement {
  const member = input.member;
  return db
    .prepare(
      `INSERT INTO discord_profiles(identity_record_id,guild_id,username,display_name,avatar,nickname,in_guild,pending,observed_at,expires_at)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${CURRENT} ON CONFLICT(identity_record_id,guild_id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,avatar=excluded.avatar,nickname=excluded.nickname,in_guild=excluded.in_guild,pending=excluded.pending,observed_at=excluded.observed_at,expires_at=excluded.expires_at WHERE excluded.observed_at>=discord_profiles.observed_at`,
    )
    .bind(
      input.plan.identityRecordId,
      input.plan.guildId,
      member?.user.username ?? null,
      member?.user.displayName ?? null,
      member?.user.avatar ?? null,
      member?.nickname ?? null,
      Number(Boolean(member)),
      Number(member?.pending ?? false),
      input.now.toISOString(),
      new Date(input.now.getTime() + 300_000).toISOString(),
      ...guards(input),
    );
}
function retryWrite(db: Db, input: DiscordSyncWrite): Statement {
  const delay = Math.max(1000, Math.min(86_400_000, input.retryAfterMs ?? 60_000));
  return db
    .prepare(
      `UPDATE integration_outbox SET state='retry',last_failure=?,attempts=attempts+1,next_attempt_at=?,updated_at=? WHERE id=? AND ${CURRENT}`,
    )
    .bind(
      input.failure ?? 'unknown',
      new Date(input.now.getTime() + delay).toISOString(),
      input.now.toISOString(),
      input.operationId,
      ...guards(input),
    );
}
function receiptWrite(db: Db, input: DiscordSyncWrite, revision: string): Statement {
  return db
    .prepare(
      `INSERT INTO provider_operation_receipts(operation_id,provider,state,failure,revision_hash,lease_token,observed_at,expires_at)
    SELECT ?,'discord',?,?,?,?,?,? WHERE ${CURRENT} ON CONFLICT(operation_id,provider) DO UPDATE SET state=excluded.state,failure=excluded.failure,revision_hash=excluded.revision_hash,lease_token=excluded.lease_token,observed_at=excluded.observed_at,expires_at=excluded.expires_at WHERE excluded.observed_at>=provider_operation_receipts.observed_at`,
    )
    .bind(
      input.operationId,
      input.failure ? 'retry' : 'done',
      input.failure ?? null,
      revision,
      input.lease.token,
      input.now.toISOString(),
      new Date(input.now.getTime() + 300_000).toISOString(),
      ...guards(input),
    );
}
/** Only the background provider adapter calls this, never staff-submitted role/profile data. */
export async function saveDiscordSync(db: Db, input: DiscordSyncWrite): Promise<boolean> {
  if (
    input.lease.guildId !== input.plan.guildId ||
    input.lease.identityId !== input.plan.identityId
  )
    return false;
  if (!input.failure && input.member === undefined) return false;
  if (
    !Number.isFinite(input.now.getTime()) ||
    (input.failure &&
      !['provider_unavailable', 'rate_limited', 'permission_denied', 'unknown'].includes(
        input.failure,
      )) ||
    (input.retryAfterMs !== undefined &&
      (!Number.isFinite(input.retryAfterMs) || input.retryAfterMs < 0))
  )
    return false;
  if (input.member && input.member.user.id !== input.plan.identityId) return false;
  const revision = await digestToken(input.plan.revision);
  await db.batch([
    ...observationWrites(db, input),
    ...(input.failure
      ? [retryWrite(db, input)]
      : input.plan.deletedAt === null
        ? [profileWrite(db, input)]
        : []),
    receiptWrite(db, input, revision),
  ]);
  const receipt = await db
    .prepare(
      "SELECT 1 AS saved FROM provider_operation_receipts WHERE operation_id=? AND provider='discord' AND revision_hash=? AND lease_token=? AND observed_at=?",
    )
    .bind(input.operationId, revision, input.lease.token, input.now.toISOString())
    .first();
  return Boolean(receipt);
}
