import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db, SqlValue } from './db';
import type { DiscordRoleTarget } from './discord-plan';
import { discordSyncGuard, type DiscordSyncWrite } from './discord-sync-store';
interface Intent {
  id: string;
  resource_id: string;
  target_id: string;
  generation: number;
  after_granted: number;
}
function targetGuard(input: DiscordSyncWrite, target: DiscordRoleTarget) {
  const base = discordSyncGuard(input);
  return {
    sql: `${base.sql} AND EXISTS(SELECT 1 FROM reconciliation_people p WHERE p.id=?
      AND coalesce((SELECT generation FROM reconcile_generations WHERE person_id=p.id AND target_id=?),0)=?
      AND (?='person' OR EXISTS(SELECT 1 FROM committee_account_mappings WHERE committee_id=? AND provider='discord' AND external_id=?)
        OR EXISTS(SELECT 1 FROM committees WHERE id=? AND discord_role_id=?))
      AND ?=CASE WHEN p.deleted_at IS NULL AND p.membership_status='member' AND (?='person' OR EXISTS(
        SELECT 1 FROM committees c JOIN committee_assignments a ON a.committee_id=c.id WHERE c.id=? AND c.discord_role_id=? AND a.person_id=p.id AND a.ended_at IS NULL)) THEN 1 ELSE 0 END)`,
    values: [
      ...base.values,
      input.plan.personId,
      target.targetId,
      target.generation,
      target.targetId,
      target.targetId,
      target.resourceId,
      target.targetId,
      target.resourceId,
      Number(target.expectedAccess),
      target.targetId,
      target.targetId,
      target.resourceId,
    ] satisfies SqlValue[],
  };
}
const REQUESTER = `SELECT s.actor_id FROM staff_operations s WHERE s.applied_at IS NOT NULL
  AND (s.operation_id=o.id OR s.operation_id||':'||o.person_id=o.id) LIMIT 1`;
const SOURCE = `coalesce(CASE json_extract(o.payload,'$.source') WHEN 'discord_drift' THEN 'discord_drift' WHEN 'membership_change' THEN 'membership_change' WHEN 'person_deleted' THEN 'person_deleted' WHEN 'discord_link' THEN 'discord_link' END,
  (SELECT s.kind FROM staff_operations s WHERE s.applied_at IS NOT NULL AND (s.operation_id=o.id OR s.operation_id||':'||o.person_id=o.id) LIMIT 1),
  CASE json_extract(o.payload,'$.action') WHEN 'settings_changed' THEN 'settings_changed' WHEN 'person.merge' THEN 'person.merge' WHEN 'person.unmerge' THEN 'person.unmerge' END,'account_update')`;
/** Record the actual pre-write role state before allowing its remote mutation. */
export async function prepareDiscordChange(
  db: Db,
  input: DiscordSyncWrite,
  change: { resourceId: string; wasGranted: boolean },
): Promise<boolean> {
  const target = input.plan.targets.find((row) => row.resourceId === change.resourceId);
  if (!target || change.wasGranted === target.expectedAccess) return false;
  const guard = targetGuard(input, target),
    revision = await digestToken(input.plan.revision);
  await db
    .prepare(
      `INSERT INTO provider_access_intents(id,provider,operation_id,person_id,identity_record_id,identity_id,context_id,resource_id,target_id,generation,revision_hash,before_granted,after_granted,source,requested_by,prepared_at)
    SELECT ?,'discord',?,?,?,?,?,?,?,?,?,?,?,${SOURCE},(${REQUESTER}),? FROM integration_outbox o WHERE o.id=? AND ${guard.sql}
    ON CONFLICT(provider,context_id,identity_id,resource_id) DO UPDATE SET id=excluded.id,operation_id=excluded.operation_id,person_id=excluded.person_id,identity_record_id=excluded.identity_record_id,target_id=excluded.target_id,generation=excluded.generation,revision_hash=excluded.revision_hash,before_granted=excluded.before_granted,after_granted=excluded.after_granted,source=excluded.source,requested_by=excluded.requested_by,prepared_at=excluded.prepared_at
    WHERE provider_access_intents.revision_hash<>excluded.revision_hash OR provider_access_intents.person_id<>excluded.person_id
      OR provider_access_intents.before_granted<>excluded.before_granted OR provider_access_intents.after_granted<>excluded.after_granted`,
    )
    .bind(
      ulid(),
      input.operationId,
      input.plan.personId,
      input.plan.identityRecordId,
      input.plan.identityId,
      input.plan.guildId,
      target.resourceId,
      target.targetId,
      target.generation,
      revision,
      Number(change.wasGranted),
      Number(target.expectedAccess),
      input.now.toISOString(),
      input.operationId,
      ...guard.values,
    )
    .run();
  const row = await db
    .prepare(
      `SELECT 1 FROM provider_access_intents WHERE provider='discord' AND context_id=? AND identity_id=? AND resource_id=? AND person_id=? AND revision_hash=? AND ${guard.sql}`,
    )
    .bind(
      input.plan.guildId,
      input.plan.identityId,
      target.resourceId,
      input.plan.personId,
      revision,
      ...guard.values,
    )
    .first();
  return Boolean(row);
}
function confirmationWrites(db: Db, input: DiscordSyncWrite, intent: Intent, revision: string) {
  const target = input.plan.targets.find((row) => row.resourceId === intent.resource_id);
  if (
    target?.targetId !== intent.target_id ||
    target.generation !== intent.generation ||
    Number(target.expectedAccess) !== intent.after_granted
  )
    return [];
  const guard = targetGuard(input, target);
  const sql = `${guard.sql} AND EXISTS(SELECT 1 FROM provider_access_intents WHERE id=? AND revision_hash=?)`;
  const values = [...guard.values, intent.id, revision];
  return [
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at)
      SELECT id,'platform:discord',CASE after_granted WHEN 1 THEN 'access.granted' ELSE 'access.revoked' END,person_id,
        json_object('provider',provider,'identityId',identity_id,'contextId',context_id,'resourceId',resource_id,'targetId',target_id,'generation',generation,'source',source,'requestedBy',requested_by,'operationId',operation_id,'preparedAt',prepared_at,'proof','provider_read'),
        'provider-change:'||id,? FROM provider_access_intents WHERE id=? AND ${sql} ON CONFLICT(id) DO NOTHING`,
      )
      .bind(input.now.toISOString(), intent.id, ...values),
    db
      .prepare(
        `DELETE FROM provider_access_intents WHERE id=? AND ${sql} AND EXISTS(SELECT 1 FROM staff_audits WHERE id=?)`,
      )
      .bind(intent.id, ...values, intent.id),
  ];
}
/** A later validated read can confirm a change whose write response was interrupted. */
export async function confirmDiscordChanges(db: Db, input: DiscordSyncWrite): Promise<void> {
  if (
    input.member === undefined ||
    (input.member && input.member.user.id !== input.plan.identityId)
  )
    return;
  const revision = await digestToken(input.plan.revision);
  const { results } = await db
    .prepare(
      `SELECT id,resource_id,target_id,generation,after_granted FROM provider_access_intents
    WHERE provider='discord' AND context_id=? AND identity_id=? AND person_id=? AND revision_hash=?`,
    )
    .bind(input.plan.guildId, input.plan.identityId, input.plan.personId, revision)
    .all<Intent>();
  const writes = results
    .filter(
      (row) => Number(input.member?.roles.includes(row.resource_id) ?? false) === row.after_granted,
    )
    .flatMap((row) => confirmationWrites(db, input, row, revision));
  if (writes.length) await db.batch(writes);
}
