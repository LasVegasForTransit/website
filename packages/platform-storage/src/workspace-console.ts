import type {
  WorkspaceConnectorPolicy,
  WorkspaceGroupPlan,
} from '@lasvegasfortransit/platform-core/workspace-connector';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db } from './db';
import type { WorkspaceEnrollment } from './workspace-enrollment';
export interface ConsolePlan extends WorkspaceGroupPlan {
  kind: 'console';
  accountId: string;
  accountRevision: number;
}
export async function consolePlan(
  db: Db,
  accountId: string,
  policy: WorkspaceConnectorPolicy,
): Promise<ConsolePlan | null> {
  const e = await db
    .prepare(
      'SELECT e.*,p.deleted_at FROM workspace_enrollments e LEFT JOIN people p ON p.id=e.person_id WHERE e.id=? AND e.customer_id=?',
    )
    .bind(accountId, policy.customerId)
    .first<WorkspaceEnrollment & { deleted_at: string | null }>();
  if (!e || (policy.environment === 'preview' && !policy.previewUserIds.includes(e.user_id)))
    return null;
  const groups = [
    ...new Set([policy.consoleGroupEmail, ...(policy.retiredConsoleGroupEmails ?? [])]),
  ].map((resourceId) => ({
    resourceId,
    desired:
      resourceId === policy.consoleGroupEmail &&
      e.state === 'active' &&
      e.person_id !== null &&
      e.deleted_at === null,
  }));
  return {
    kind: 'console',
    accountId: e.id,
    accountRevision: e.revision,
    personId: e.person_id,
    customerId: e.customer_id,
    userId: e.user_id,
    email: e.email,
    operationId: `workspace-console:${e.id}:${e.revision}`,
    revision: JSON.stringify([e.revision, e.person_id, e.state, e.email, groups]),
    groups,
  };
}
export async function claimConsole(
  db: Db,
  policy: WorkspaceConnectorPolicy,
  input: { lease: string; now: Date; personId?: string },
) {
  const { lease, now, personId } = input;
  const e = await db
    .prepare(
      `UPDATE workspace_directory_accounts SET console_lease=?,console_lease_until=? WHERE id=(SELECT id FROM workspace_directory_accounts
    WHERE customer_id=? AND (?='production' OR user_id IN (SELECT value FROM json_each(?))) AND console_due_at<=? AND (identity_record_id IS NOT NULL OR state='revoked')
    AND (? IS NULL OR identity_record_id IN (SELECT id FROM identities WHERE person_id=?)) AND (console_lease_until IS NULL OR console_lease_until<=?) ORDER BY console_due_at,id LIMIT 1) RETURNING id`,
    )
    .bind(
      lease,
      new Date(now.getTime() + 30000).toISOString(),
      policy.customerId,
      policy.environment,
      JSON.stringify(policy.previewUserIds),
      now.toISOString(),
      personId ?? null,
      personId ?? null,
      now.toISOString(),
    )
    .first<{ id: string }>();
  return e ? consolePlan(db, e.id, policy) : null;
}
export function consoleGuard(plan: ConsolePlan, lease: string, now: Date) {
  return {
    sql: 'id=? AND revision=? AND console_lease=? AND console_lease_until>?',
    values: [plan.accountId, plan.accountRevision, lease, now.toISOString()],
  };
}
export async function currentConsole(
  db: Db,
  input: { plan: ConsolePlan; lease: string; policy: WorkspaceConnectorPolicy; now: Date },
) {
  const { plan, lease, policy, now } = input;
  const current = await consolePlan(db, plan.accountId, policy);
  if (current?.revision !== plan.revision) return false;
  const g = consoleGuard(plan, lease, now);
  return (
    (
      await db
        .prepare(`UPDATE workspace_directory_accounts SET console_lease_until=? WHERE ${g.sql}`)
        .bind(new Date(now.getTime() + 30000).toISOString(), ...g.values)
        .run()
    ).meta.changes > 0
  );
}
export async function prepareConsole(
  db: Db,
  input: { plan: ConsolePlan; lease: string; resourceId: string; wasGranted: boolean; now: Date },
) {
  const { plan, lease, resourceId, wasGranted, now } = input;
  const group = plan.groups.find((g) => g.resourceId === resourceId);
  if (!group) return false;
  const guard = consoleGuard(plan, lease, now);
  const result = await db
    .prepare(
      `INSERT INTO workspace_console_checks(account_id,resource_id,revision,lease_hash,before_granted)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace_directory_accounts WHERE ${guard.sql})
    ON CONFLICT(account_id,resource_id) DO UPDATE SET revision=excluded.revision,lease_hash=excluded.lease_hash,before_granted=excluded.before_granted,granted=NULL,observed_at=NULL,expires_at=NULL`,
    )
    .bind(plan.accountId, resourceId, plan.revision, lease, Number(wasGranted), ...guard.values)
    .run();
  return result.meta.changes > 0;
}
export async function observeConsole(
  db: Db,
  input: {
    plan: ConsolePlan;
    lease: string;
    resourceId: string;
    groupId: string;
    granted: boolean;
    now: Date;
  },
) {
  const { plan, lease, resourceId, groupId, granted, now } = input;
  const guard = consoleGuard(plan, lease, now);
  await db.batch([
    db
      .prepare(
        `INSERT INTO workspace_console_checks(account_id,resource_id,revision,lease_hash,granted,group_id,observed_at,expires_at)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace_directory_accounts WHERE ${guard.sql})
      ON CONFLICT(account_id,resource_id) DO UPDATE SET revision=excluded.revision,lease_hash=excluded.lease_hash,
      granted=excluded.granted,group_id=excluded.group_id,observed_at=excluded.observed_at,expires_at=excluded.expires_at`,
      )
      .bind(
        plan.accountId,
        resourceId,
        plan.revision,
        lease,
        Number(granted),
        groupId,
        now.toISOString(),
        new Date(now.getTime() + 300000).toISOString(),
        ...guard.values,
      ),
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at)
      SELECT ?,'platform:google_workspace',?, ?,?,?,? FROM workspace_console_checks c WHERE c.account_id=? AND c.resource_id=? AND c.revision=?
      AND c.before_granted IS NOT NULL AND c.before_granted<>? AND EXISTS(SELECT 1 FROM workspace_directory_accounts WHERE ${guard.sql})
      AND NOT EXISTS(SELECT 1 FROM staff_audits WHERE operation_id=?)`,
      )
      .bind(
        ulid(),
        granted ? 'access.granted' : 'access.revoked',
        plan.personId ?? plan.accountId,
        JSON.stringify({
          system: 'google_group',
          provider: 'google_workspace',
          resourceId,
          identityId: plan.userId,
          source: 'workspace_onboarding',
          proof: 'provider_read',
        }),
        `${plan.operationId}:${await digestToken(resourceId)}`,
        now.toISOString(),
        plan.accountId,
        resourceId,
        plan.revision,
        Number(granted),
        ...guard.values,
        `${plan.operationId}:${await digestToken(resourceId)}`,
      ),
  ]);
}
export async function finishConsole(
  db: Db,
  input: { plan: ConsolePlan; lease: string; now: Date; failure?: string },
) {
  const { plan, lease, now, failure } = input;
  const guard = consoleGuard(plan, lease, now);
  const groups = JSON.stringify(plan.groups);
  const result = await db
    .prepare(
      `UPDATE workspace_directory_accounts SET console_state=?,console_checked_at=?,console_failure=?,console_attempts=console_attempts+?,
    console_due_at=?,console_lease=NULL,console_lease_until=NULL WHERE ${guard.sql}
    ${
      failure
        ? ''
        : `AND NOT EXISTS(SELECT 1 FROM json_each(?) g WHERE NOT EXISTS(SELECT 1 FROM workspace_console_checks c WHERE c.account_id=workspace_directory_accounts.id
      AND c.resource_id=json_extract(g.value,'$.resourceId') AND c.granted=json_extract(g.value,'$.desired') AND c.revision=? AND c.lease_hash=? AND c.expires_at>? AND c.observed_at<=?))`
    }`,
    )
    .bind(
      failure ? 'unknown' : plan.groups.some((g) => g.desired) ? 'granted' : 'absent',
      failure ? null : now.toISOString(),
      failure ?? null,
      Number(Boolean(failure)),
      new Date(now.getTime() + (failure ? 60000 : 86400000)).toISOString(),
      ...guard.values,
      ...(failure ? [] : [groups, plan.revision, lease, now.toISOString(), now.toISOString()]),
    )
    .run();
  return result.meta.changes > 0;
}
