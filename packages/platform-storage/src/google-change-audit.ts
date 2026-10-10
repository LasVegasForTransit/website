import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from './db';
import { googleSyncGuard, type GoogleSyncWrite } from './google-sync-store';

export async function prepareGoogleChange(
  db: Db,
  input: GoogleSyncWrite,
  change: { resourceId: string; wasGranted: boolean },
): Promise<boolean> {
  const group = input.plan.groups.find((group) => group.resourceId === change.resourceId);
  const target = input.plan.targets.find(
    (target) => target.resourceId === change.resourceId && target.expectedAccess === group?.desired,
  );
  if (!group || !target) return false;
  const guard = googleSyncGuard(input),
    revision = await digestToken(input.plan.revision);
  if (change.wasGranted === group.desired)
    return Boolean(
      await db
        .prepare(`SELECT 1 WHERE ${guard.sql}`)
        .bind(...guard.values)
        .first(),
    );
  await db
    .prepare(
      `INSERT INTO provider_access_intents(id,provider,operation_id,person_id,identity_record_id,identity_id,context_id,resource_id,target_id,generation,revision_hash,before_granted,after_granted,source,requested_by,prepared_at)
    SELECT ?,'google_workspace',?,?,?,?,?,?,?,?,?,?,?,coalesce((SELECT s.kind FROM staff_operations s WHERE s.applied_at IS NOT NULL AND (s.operation_id=o.id OR s.operation_id||':'||o.person_id=o.id) LIMIT 1),'account_update'),(SELECT s.actor_id FROM staff_operations s WHERE s.applied_at IS NOT NULL AND (s.operation_id=o.id OR s.operation_id||':'||o.person_id=o.id) LIMIT 1),? FROM integration_outbox o WHERE o.id=? AND ${guard.sql}
    ON CONFLICT(provider,context_id,identity_id,resource_id) DO UPDATE SET id=excluded.id,operation_id=excluded.operation_id,person_id=excluded.person_id,identity_record_id=excluded.identity_record_id,target_id=excluded.target_id,generation=excluded.generation,revision_hash=excluded.revision_hash,before_granted=excluded.before_granted,after_granted=excluded.after_granted,source=excluded.source,requested_by=excluded.requested_by,prepared_at=excluded.prepared_at
    WHERE provider_access_intents.revision_hash<>excluded.revision_hash OR provider_access_intents.person_id<>excluded.person_id OR provider_access_intents.before_granted<>excluded.before_granted OR provider_access_intents.after_granted<>excluded.after_granted`,
    )
    .bind(
      ulid(),
      input.plan.operationId,
      input.plan.personId,
      input.plan.identityRecordId,
      input.plan.identityId,
      input.plan.customerId,
      change.resourceId,
      target.targetId,
      target.generation,
      revision,
      Number(change.wasGranted),
      Number(group.desired),
      input.now.toISOString(),
      input.plan.operationId,
      ...guard.values,
    )
    .run();
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM provider_access_intents WHERE provider='google_workspace' AND context_id=? AND identity_id=? AND resource_id=? AND revision_hash=? AND person_id=? AND ${guard.sql}`,
      )
      .bind(
        input.plan.customerId,
        input.plan.identityId,
        change.resourceId,
        revision,
        input.plan.personId,
        ...guard.values,
      )
      .first(),
  );
}
export async function confirmGoogleChange(
  db: Db,
  input: GoogleSyncWrite,
  observed: { groupEmail: string; identityId: string; granted: boolean },
): Promise<void> {
  if (observed.identityId !== input.plan.identityId) return;
  const guard = googleSyncGuard(input),
    revision = await digestToken(input.plan.revision);
  const { results } = await db
    .prepare(
      "SELECT id FROM provider_access_intents WHERE provider='google_workspace' AND context_id=? AND identity_id=? AND person_id=? AND resource_id=? AND revision_hash=? AND after_granted=?",
    )
    .bind(
      input.plan.customerId,
      input.plan.identityId,
      input.plan.personId,
      observed.groupEmail,
      revision,
      Number(observed.granted),
    )
    .all<{ id: string }>();
  for (const intent of results)
    await db.batch([
      db
        .prepare(
          `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at)
      SELECT id,'platform:google_workspace',CASE after_granted WHEN 1 THEN 'access.granted' ELSE 'access.revoked' END,person_id,json_object('provider',provider,'identityId',identity_id,'contextId',context_id,'resourceId',resource_id,'targetId',target_id,'generation',generation,'source',source,'requestedBy',requested_by,'operationId',operation_id,'preparedAt',prepared_at,'proof','provider_read'),'provider-change:'||id,? FROM provider_access_intents WHERE id=? AND ${guard.sql} ON CONFLICT(id) DO NOTHING`,
        )
        .bind(input.now.toISOString(), intent.id, ...guard.values),
      db
        .prepare(
          `DELETE FROM provider_access_intents WHERE id=? AND ${guard.sql} AND EXISTS(SELECT 1 FROM staff_audits WHERE id=?)`,
        )
        .bind(intent.id, ...guard.values, intent.id),
    ]);
}
