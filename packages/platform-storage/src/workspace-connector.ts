import { randomToken, digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type {
  WorkspaceConnectorPolicy,
  WorkspaceGroupClaim,
  WorkspaceGroupPlan,
} from '@lasvegasfortransit/platform-core/workspace-connector';
import type { Db } from './db';
import { loadGooglePlan, type GooglePlan } from './google-plan';
import { pendingGoogleOperations } from './google-pending';
import {
  claimGoogleLease,
  renewGoogleLease,
  releaseGoogleLease,
  saveGoogleGroup,
  saveGoogleReceipt,
  type GoogleLease,
} from './google-sync-store';
import { prepareGoogleChange, confirmGoogleChange } from './google-change-audit';
import {
  claimConsole,
  currentConsole,
  prepareConsole,
  observeConsole,
  finishConsole,
  type ConsolePlan,
} from './workspace-console';
interface ClaimRow {
  token_hash: string;
  kind: 'console' | 'committee';
  plan: string;
  lease: string | null;
  expires_at: string;
}
interface StoredClaim {
  row: ClaimRow;
  public: WorkspaceGroupPlan;
  console?: ConsolePlan;
  google?: GooglePlan;
  lease?: GoogleLease;
}
export interface ConnectorObservation {
  identityId: string;
  identityEmail: string | null;
  groupEmail: string;
  groupId: string;
  direct: boolean;
  granted: boolean;
  role: string | null;
}
async function store(
  db: Db,
  input: {
    kind: ClaimRow['kind'];
    plan: ConsolePlan | GooglePlan;
    token: string;
    lease: GoogleLease | null;
    now: Date;
  },
) {
  const { kind, plan, token, lease, now } = input;
  await db
    .prepare(
      'INSERT INTO workspace_connector_claims(token_hash,kind,plan,lease,created_at,expires_at) VALUES(?,?,?,?,?,?)',
    )
    .bind(
      await digestToken(token),
      kind,
      JSON.stringify(plan),
      lease ? JSON.stringify(lease) : null,
      now.toISOString(),
      new Date(now.getTime() + 300000).toISOString(),
    )
    .run();
}
function publicPlan(plan: GooglePlan): WorkspaceGroupPlan {
  return {
    kind: 'committee',
    personId: plan.personId,
    customerId: plan.customerId,
    userId: plan.identityId,
    email: plan.identityEmail,
    operationId: plan.operationId,
    revision: plan.revision,
    groups: plan.groups,
  };
}
export async function claimWorkspaceGroup(
  db: Db,
  policy: WorkspaceConnectorPolicy,
  now: Date,
  personId?: string,
): Promise<WorkspaceGroupClaim | null> {
  const token = randomToken(),
    hash = await digestToken(token);
  const base = await claimConsole(db, policy, {
    lease: hash,
    now,
    ...(personId ? { personId } : {}),
  });
  if (base) {
    await store(db, { kind: 'console', plan: base, token, lease: null, now });
    return { token, plan: base };
  }
  for (const operationId of await pendingGoogleOperations(db, now, 10, {
    ...(personId ? { personId } : {}),
    ...(policy.environment === 'preview' ? { userIds: policy.previewUserIds } : {}),
  })) {
    const retry = await db
      .prepare('SELECT 1 FROM workspace_google_retries WHERE operation_id=? AND next_attempt_at>?')
      .bind(operationId, now.toISOString())
      .first();
    if (retry) continue;
    const job = await db
      .prepare('SELECT person_id FROM integration_outbox WHERE id=?')
      .bind(operationId)
      .first<{ person_id: string }>();
    if (!job) continue;
    const plan = await loadGooglePlan(db, {
      personId: job.person_id,
      operationId,
      customerId: policy.customerId,
    });
    if (
      !plan ||
      (policy.environment === 'preview' && !policy.previewUserIds.includes(plan.identityId)) ||
      plan.groups.some((g) => !policy.managedGroups.includes(g.resourceId))
    )
      continue;
    const lease = await claimGoogleLease(db, plan, now);
    if (!lease) continue;
    await store(db, { kind: 'committee', plan, token, lease, now });
    return { token, plan: publicPlan(plan) };
  }
  return null;
}
async function readClaim(db: Db, token: string, now: Date): Promise<StoredClaim | null> {
  if (!/^[\w-]{43}$/.test(token)) return null;
  const row = await db
    .prepare('SELECT * FROM workspace_connector_claims WHERE token_hash=? AND expires_at>?')
    .bind(await digestToken(token), now.toISOString())
    .first<ClaimRow>();
  if (!row) return null;
  if (row.kind === 'console') {
    const plan = JSON.parse(row.plan) as ConsolePlan;
    return { row, public: plan, console: plan };
  }
  const plan = JSON.parse(row.plan) as GooglePlan,
    lease = JSON.parse(row.lease ?? 'null') as GoogleLease;
  return { row, public: publicPlan(plan), google: plan, lease };
}
async function current(db: Db, claim: StoredClaim, policy: WorkspaceConnectorPolicy, now: Date) {
  if (
    claim.public.customerId !== policy.customerId ||
    (policy.environment === 'preview' && !policy.previewUserIds.includes(claim.public.userId))
  )
    return false;
  if (claim.console)
    return currentConsole(db, { plan: claim.console, lease: claim.row.token_hash, policy, now });
  return (
    !!claim.google &&
    !!claim.lease &&
    claim.google.groups.every((g) => policy.managedGroups.includes(g.resourceId)) &&
    renewGoogleLease(db, { plan: claim.google, lease: claim.lease, now })
  );
}
export async function workspaceGroupCurrent(
  db: Db,
  token: string,
  policy: WorkspaceConnectorPolicy,
  now: Date,
) {
  const claim = await readClaim(db, token, now);
  return !!claim && current(db, claim, policy, now);
}
export async function prepareWorkspaceGroup(
  db: Db,
  input: { token: string; resourceId: string; wasGranted: boolean },
  policy: WorkspaceConnectorPolicy,
  now: Date,
) {
  const { token, resourceId, wasGranted } = input;
  const c = await readClaim(db, token, now);
  if (!c || !(await current(db, c, policy, now))) return false;
  if (c.console)
    return prepareConsole(db, {
      plan: c.console,
      lease: c.row.token_hash,
      resourceId,
      wasGranted,
      now,
    });
  return (
    !!c.google &&
    !!c.lease &&
    prepareGoogleChange(db, { plan: c.google, lease: c.lease, now }, { resourceId, wasGranted })
  );
}
function validObservation(value: unknown): value is ConnectorObservation {
  if (!value || typeof value !== 'object') return false;
  const o = value as ConnectorObservation;
  return (
    typeof o.identityId === 'string' &&
    typeof o.groupEmail === 'string' &&
    typeof o.groupId === 'string' &&
    /^[\w-]{1,128}$/.test(o.groupId) &&
    typeof o.direct === 'boolean' &&
    typeof o.granted === 'boolean' &&
    (!o.direct || o.granted) &&
    (o.direct ? ['MEMBER', 'MANAGER', 'OWNER'].includes(o.role ?? '') : o.role === null)
  );
}
export async function observeWorkspaceGroup(
  db: Db,
  input: { token: string; observed: unknown },
  policy: WorkspaceConnectorPolicy,
  now: Date,
) {
  const { token, observed } = input;
  const c = await readClaim(db, token, now);
  if (!c || !validObservation(observed) || !(await current(db, c, policy, now))) return false;
  const group = c.public.groups.find((g) => g.resourceId === observed.groupEmail);
  if (
    !group ||
    observed.identityId !== c.public.userId ||
    observed.identityEmail !== c.public.email
  )
    return false;
  const confirmed = observed.granted === group.desired && (!group.desired || observed.direct);
  if (c.console) {
    if (confirmed)
      await observeConsole(db, {
        plan: c.console,
        lease: c.row.token_hash,
        resourceId: group.resourceId,
        groupId: observed.groupId,
        granted: observed.granted,
        now,
      });
  } else if (c.google && c.lease) {
    const input = { plan: c.google, lease: c.lease, now };
    await confirmGoogleChange(db, input, observed);
    if (confirmed && !(await saveGoogleGroup(db, input, group.resourceId, observed.granted)))
      return false;
  }
  return true;
}
export async function finishWorkspaceGroup(
  db: Db,
  input: {
    token: string;
    failure?: {
      kind: 'unknown' | 'permission_denied' | 'provider_unavailable' | 'rate_limited';
      retryAfterMs: number;
      resourceId: string | null;
      reviewReason?: 'inherited_access';
    };
  },
  policy: WorkspaceConnectorPolicy,
  now: Date,
) {
  const { token, failure } = input;
  const c = await readClaim(db, token, now);
  if (!c || !(await current(db, c, policy, now))) return false;
  let saved = false;
  if (c.console)
    saved = await finishConsole(db, {
      plan: c.console,
      lease: c.row.token_hash,
      now,
      ...(failure ? { failure: failure.kind } : {}),
    });
  else if (c.google && c.lease) {
    saved = await saveGoogleReceipt(
      db,
      { plan: c.google, lease: c.lease, now },
      failure ? { ...failure, deferSharedOperation: false } : undefined,
    );
    if (saved && failure)
      await db
        .prepare(
          `INSERT INTO workspace_google_retries(operation_id,next_attempt_at,failure) VALUES(?,?,?) ON CONFLICT(operation_id) DO UPDATE SET next_attempt_at=excluded.next_attempt_at,failure=excluded.failure`,
        )
        .bind(
          c.google.operationId,
          new Date(
            now.getTime() + Math.min(86400000, Math.max(1000, failure.retryAfterMs)),
          ).toISOString(),
          failure.kind,
        )
        .run();
    if (saved) await releaseGoogleLease(db, c.lease);
  }
  if (saved)
    await db
      .prepare('DELETE FROM workspace_connector_claims WHERE token_hash=?')
      .bind(c.row.token_hash)
      .run();
  return saved;
}
