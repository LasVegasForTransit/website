import type { AccessObservation } from '@lasvegasfortransit/platform-core/access';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db, Statement, SqlValue } from './db';
const FAILURES = ['provider_unavailable', 'rate_limited', 'permission_denied', 'unknown'];
function validTimes(input: AccessObservation, now: Date): boolean {
  const stamp = Date.parse(input.observedAt),
    expires = Date.parse(input.expiresAt);
  return (
    Number.isFinite(stamp) &&
    Number.isFinite(expires) &&
    stamp <= now.getTime() &&
    expires > stamp &&
    expires <= stamp + 300_000 &&
    new Date(stamp).toISOString() === input.observedAt &&
    new Date(expires).toISOString() === input.expiresAt
  );
}
function valid(input: AccessObservation, now: Date): boolean {
  return (
    ['google_workspace', 'discord'].includes(input.provider) &&
    ['granted', 'absent', 'unknown'].includes(input.state) &&
    (!input.failure || (input.state === 'unknown' && FAILURES.includes(input.failure))) &&
    [input.identityId, input.resourceId, input.contextId].every(
      (value) => value.length > 0 && value.length <= 254,
    ) &&
    Number.isSafeInteger(input.generation) &&
    input.generation >= 0 &&
    validTimes(input, now)
  );
}
/** Used by provider readers, never accepted from a staff form or a successful write alone. */
export function accessObservationWrite(
  db: Db,
  input: AccessObservation,
  now: Date = new Date(),
  guard?: { sql: string; values: SqlValue[] },
): Statement | null {
  if (!valid(input, now)) return null;
  return db
    .prepare(
      `INSERT INTO access_observations (id,person_id,target_id,provider,identity_id,identity_email,resource_id,context_id,generation,expected_access,state,failure,observed_at,expires_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM people p WHERE p.id=? AND p.deleted_at IS NULL
    AND EXISTS(SELECT 1 FROM identities i WHERE i.person_id=p.id AND i.platform=? AND i.external_id=? AND i.external_email IS ?
      AND (i.platform<>'discord' OR i.link_method IN ('self_linked','staff_confirmed')))
    AND (SELECT count(*) FROM identities WHERE person_id=p.id AND platform=?)=1
    AND coalesce((SELECT generation FROM reconcile_generations WHERE person_id=p.id AND target_id=?),0)=?
    AND (?='person' OR EXISTS(SELECT 1 FROM committees c WHERE c.id=? AND CASE ? WHEN 'discord' THEN c.discord_role_id ELSE c.workspace_group_email END=?))
    AND (?=CASE WHEN p.membership_status='member' AND (?='person' OR EXISTS(SELECT 1 FROM committee_assignments a WHERE a.person_id=p.id AND a.committee_id=? AND a.ended_at IS NULL)) THEN 1 ELSE 0 END)
    AND (${guard?.sql ?? '1=1'})`,
    )
    .bind(
      ulid(),
      input.personId,
      input.targetId,
      input.provider,
      input.identityId,
      input.identityEmail,
      input.resourceId,
      input.contextId,
      input.generation,
      Number(input.expectedAccess),
      input.state,
      input.failure ?? null,
      input.observedAt,
      input.expiresAt,
      input.personId,
      input.provider,
      input.identityId,
      input.identityEmail,
      input.provider,
      input.targetId,
      input.generation,
      input.targetId,
      input.targetId,
      input.provider,
      input.resourceId,
      Number(input.expectedAccess),
      input.targetId,
      input.targetId,
      ...(guard?.values ?? []),
    );
}
export async function recordAccessObservation(
  db: Db,
  input: AccessObservation,
  now: Date = new Date(),
): Promise<boolean> {
  const statement = accessObservationWrite(db, input, now);
  if (!statement) return false;
  const result = await statement.run();
  return result.meta.changes === 1;
}
