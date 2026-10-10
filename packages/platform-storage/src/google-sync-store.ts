import type { AccessFailure } from '@lasvegasfortransit/platform-core/access';
import { randomToken, digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db, Statement, SqlValue } from './db';
import { accessObservationWrite } from './access-observations';
import { googlePlanGuard, type GooglePlan } from './google-plan';
export interface GoogleLease {
  customerId: string;
  identityId: string;
  token: string;
}
export interface GoogleSyncWrite {
  plan: GooglePlan;
  lease: GoogleLease;
  now: Date;
}
export function googleSyncGuard(input: GoogleSyncWrite) {
  if (
    input.lease.customerId !== input.plan.customerId ||
    input.lease.identityId !== input.plan.identityId
  )
    return { sql: '0=1', values: [] as SqlValue[] };
  const base = googlePlanGuard(input.plan);
  return {
    sql: `${base.sql} AND EXISTS(SELECT 1 FROM provider_account_leases WHERE provider='google_workspace' AND context_id=? AND identity_id=? AND token=? AND expires_at>?)`,
    values: [
      ...base.values,
      input.lease.customerId,
      input.lease.identityId,
      input.lease.token,
      input.now.toISOString(),
    ] satisfies SqlValue[],
  };
}
export async function claimGoogleLease(
  db: Db,
  plan: GooglePlan,
  now: Date,
): Promise<GoogleLease | null> {
  const lease = { customerId: plan.customerId, identityId: plan.identityId, token: randomToken() };
  const guard = googlePlanGuard(plan);
  const result = await db
    .prepare(
      `INSERT INTO provider_account_leases(provider,context_id,identity_id,token,expires_at)
    SELECT 'google_workspace',?,?,?,? WHERE ${guard.sql} ON CONFLICT(provider,context_id,identity_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE provider_account_leases.expires_at<=?`,
    )
    .bind(
      lease.customerId,
      lease.identityId,
      lease.token,
      new Date(now.getTime() + 30000).toISOString(),
      ...guard.values,
      now.toISOString(),
    )
    .run();
  return result.meta.changes === 1 ? lease : null;
}
export async function renewGoogleLease(db: Db, input: GoogleSyncWrite): Promise<boolean> {
  const guard = googleSyncGuard(input);
  const result = await db
    .prepare(
      `UPDATE provider_account_leases SET expires_at=? WHERE provider='google_workspace' AND context_id=? AND identity_id=? AND token=? AND ${guard.sql}`,
    )
    .bind(
      new Date(input.now.getTime() + 30000).toISOString(),
      input.lease.customerId,
      input.lease.identityId,
      input.lease.token,
      ...guard.values,
    )
    .run();
  return result.meta.changes === 1;
}
export async function releaseGoogleLease(db: Db, lease: GoogleLease): Promise<void> {
  await db
    .prepare(
      "DELETE FROM provider_account_leases WHERE provider='google_workspace' AND context_id=? AND identity_id=? AND token=?",
    )
    .bind(lease.customerId, lease.identityId, lease.token)
    .run();
}
function observations(
  db: Db,
  input: GoogleSyncWrite,
  resourceId: string,
  state: { granted: boolean; failure?: AccessFailure },
): Statement[] {
  const { granted, failure } = state;
  const guard = googleSyncGuard(input);
  return input.plan.targets
    .filter((target) => target.current && target.resourceId === resourceId)
    .flatMap((target) => {
      const write = accessObservationWrite(
        db,
        {
          personId: input.plan.personId,
          targetId: target.targetId,
          provider: 'google_workspace',
          identityId: input.plan.identityId,
          identityEmail: input.plan.identityEmail,
          resourceId,
          contextId: input.plan.customerId,
          generation: target.generation,
          expectedAccess: target.expectedAccess,
          state: failure ? 'unknown' : granted ? 'granted' : 'absent',
          ...(failure ? { failure } : {}),
          observedAt: input.now.toISOString(),
          expiresAt: new Date(input.now.getTime() + 300000).toISOString(),
        },
        input.now,
        guard,
      );
      return write ? [write] : [];
    });
}
export async function googleCheckpoints(db: Db, input: GoogleSyncWrite): Promise<Set<string>> {
  const revision = await digestToken(input.plan.revision);
  const { results } = await db
    .prepare(
      'SELECT resource_id FROM google_group_checkpoints WHERE operation_id=? AND revision_hash=? AND expires_at>? AND observed_at<=?',
    )
    .bind(input.plan.operationId, revision, input.now.toISOString(), input.now.toISOString())
    .all<{ resource_id: string }>();
  return new Set(results.map((row) => row.resource_id));
}
export async function saveGoogleGroup(
  db: Db,
  input: GoogleSyncWrite,
  resourceId: string,
  granted: boolean,
): Promise<boolean> {
  if (
    !input.plan.groups.some(
      (group) => group.resourceId === resourceId && group.desired === granted,
    ) ||
    input.lease.customerId !== input.plan.customerId ||
    input.lease.identityId !== input.plan.identityId
  )
    return false;
  const guard = googleSyncGuard(input),
    revision = await digestToken(input.plan.revision);
  const result = await db.batch([
    ...observations(db, input, resourceId, { granted }),
    db
      .prepare(
        `INSERT INTO google_group_checkpoints(operation_id,resource_id,revision_hash,lease_token,observed_at,expires_at)
    SELECT ?,?,?,?,?,? WHERE ${guard.sql} ON CONFLICT(operation_id,resource_id) DO UPDATE SET revision_hash=excluded.revision_hash,lease_token=excluded.lease_token,observed_at=excluded.observed_at,expires_at=excluded.expires_at WHERE excluded.observed_at>=google_group_checkpoints.observed_at`,
      )
      .bind(
        input.plan.operationId,
        resourceId,
        revision,
        input.lease.token,
        input.now.toISOString(),
        new Date(input.now.getTime() + 300000).toISOString(),
        ...guard.values,
      ),
  ]);
  return changed(result.at(-1));
}
function changed(result: unknown): boolean {
  if (typeof result !== 'object' || result === null || !('meta' in result)) return false;
  const meta = result.meta;
  return typeof meta === 'object' && meta !== null && 'changes' in meta && meta.changes === 1;
}
function receiptWrite(
  db: Db,
  input: GoogleSyncWrite,
  state: { revision: string; failure?: AccessFailure },
): Statement {
  const guard = googleSyncGuard(input),
    resources = JSON.stringify(input.plan.groups.map((group) => group.resourceId));
  const evidence = state.failure
    ? ''
    : ` AND NOT EXISTS(SELECT 1 FROM json_each(?) selected WHERE NOT EXISTS(
    SELECT 1 FROM google_group_checkpoints proof WHERE proof.operation_id=? AND proof.resource_id=selected.value AND proof.revision_hash=? AND proof.expires_at>? AND proof.observed_at<=?))`;
  const deadline = new Date(input.now.getTime() + 300000).toISOString();
  const expiry = state.failure
    ? '?'
    : `coalesce((SELECT min(expires_at) FROM google_group_checkpoints WHERE operation_id=? AND revision_hash=? AND resource_id IN (SELECT value FROM json_each(?))),?)`;
  const expiryValues = state.failure
    ? [deadline]
    : [input.plan.operationId, state.revision, resources, deadline];
  const evidenceValues = state.failure
    ? []
    : [
        resources,
        input.plan.operationId,
        state.revision,
        input.now.toISOString(),
        input.now.toISOString(),
      ];
  return db
    .prepare(
      `INSERT INTO provider_operation_receipts(operation_id,provider,state,failure,revision_hash,lease_token,observed_at,expires_at)
    SELECT ?,'google_workspace',?,?,?,?,?,${expiry} WHERE ${guard.sql}${evidence} ON CONFLICT(operation_id,provider) DO UPDATE SET state=excluded.state,failure=excluded.failure,revision_hash=excluded.revision_hash,lease_token=excluded.lease_token,observed_at=excluded.observed_at,expires_at=excluded.expires_at WHERE excluded.observed_at>=provider_operation_receipts.observed_at`,
    )
    .bind(
      input.plan.operationId,
      state.failure ? 'retry' : 'done',
      state.failure ?? null,
      state.revision,
      input.lease.token,
      input.now.toISOString(),
      ...expiryValues,
      ...guard.values,
      ...evidenceValues,
    );
}
/** A Google-only receipt never marks the shared operation done. */
export async function saveGoogleReceipt(
  db: Db,
  input: GoogleSyncWrite,
  failure?: { kind: AccessFailure; retryAfterMs: number; resourceId: string | null },
): Promise<boolean> {
  const guard = googleSyncGuard(input),
    revision = await digestToken(input.plan.revision);
  const writes: Statement[] = [];
  if (failure) {
    const delay = Math.min(86400000, Math.max(1000, failure.retryAfterMs));
    if (!Number.isFinite(delay)) return false;
    for (const group of input.plan.groups.filter(
      (group) => failure.resourceId === null || group.resourceId === failure.resourceId,
    ))
      writes.push(
        ...observations(db, input, group.resourceId, { granted: false, failure: failure.kind }),
      );
    writes.push(
      db
        .prepare(
          `UPDATE integration_outbox SET state='retry',last_failure=?,attempts=attempts+1,next_attempt_at=?,updated_at=? WHERE id=? AND ${guard.sql}`,
        )
        .bind(
          failure.kind,
          new Date(input.now.getTime() + delay).toISOString(),
          input.now.toISOString(),
          input.plan.operationId,
          ...guard.values,
        ),
    );
  }
  writes.push(receiptWrite(db, input, { revision, ...(failure ? { failure: failure.kind } : {}) }));
  const results = await db.batch(writes);
  return changed(results.at(-1));
}
