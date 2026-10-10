import type { AccessFailure } from '@lasvegasfortransit/platform-core/access';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { loadGooglePlan, type GooglePlan } from '@lasvegasfortransit/platform-storage/google-plan';
import {
  claimGoogleLease,
  renewGoogleLease,
  releaseGoogleLease,
  googleCheckpoints,
  saveGoogleGroup,
  saveGoogleReceipt,
  type GoogleLease,
} from '@lasvegasfortransit/platform-storage/google-sync-store';
import {
  prepareGoogleChange,
  confirmGoogleChange,
} from '@lasvegasfortransit/platform-storage/google-change-audit';
import { GoogleGroupsFailure, type GoogleGroups } from './google-groups';
export type GoogleSyncResult =
  | { kind: 'confirmed' | 'partial' | 'stale' | 'busy' | 'not_ready' }
  | { kind: 'retry'; failure: AccessFailure; retryAfterMs: number };
interface Options {
  client: GoogleGroups;
  maxGroups?: number;
  now?: () => Date;
}
interface Run {
  db: Db;
  plan: GooglePlan;
  lease: GoogleLease;
  options: Options;
  now: () => Date;
  started: Date;
  maxGroups: number;
}
function write(run: Run) {
  return { plan: run.plan, lease: run.lease, now: run.now() };
}
async function current(run: Run) {
  return await renewGoogleLease(run.db, write(run));
}
async function groupSync(run: Run, group: GooglePlan['groups'][number]): Promise<boolean> {
  const observed = await run.options.client.reconcile({
    identityId: run.plan.identityId,
    identityEmail: run.plan.identityEmail,
    groupEmail: group.resourceId,
    desired: group.desired,
    operationId: run.plan.operationId,
    isCurrent: async () => await current(run),
    journal: {
      prepare: async (change) => await prepareGoogleChange(run.db, write(run), change),
      observe: async (state) => await confirmGoogleChange(run.db, write(run), state),
    },
  });
  return (
    (await current(run)) &&
    (await saveGoogleGroup(run.db, write(run), group.resourceId, observed.granted))
  );
}
async function failed(
  run: Run,
  error: unknown,
  resourceId: string | null,
): Promise<GoogleSyncResult> {
  if (!(await current(run))) return { kind: 'stale' };
  const kind = error instanceof GoogleGroupsFailure ? error.kind : 'unknown';
  const failure: AccessFailure = [
    'provider_unavailable',
    'rate_limited',
    'permission_denied',
  ].includes(kind)
    ? (kind as AccessFailure)
    : 'unknown';
  const retryAfterMs = error instanceof GoogleGroupsFailure ? (error.retryAfterMs ?? 60000) : 60000;
  const saved = await saveGoogleReceipt(run.db, write(run), {
    kind: failure,
    retryAfterMs,
    resourceId,
  });
  return saved && (await current(run))
    ? { kind: 'retry', failure, retryAfterMs }
    : { kind: 'stale' };
}
async function execute(run: Run): Promise<GoogleSyncResult> {
  let resourceId: string | null = null;
  try {
    const completed = await googleCheckpoints(run.db, write(run));
    let processed = 0;
    for (const group of run.plan.groups) {
      if (completed.has(group.resourceId)) continue;
      if (processed >= run.maxGroups || run.now().getTime() - run.started.getTime() >= 45000)
        return { kind: 'partial' };
      resourceId = group.resourceId;
      if (!(await groupSync(run, group))) return { kind: 'stale' };
      processed++;
    }
    return (await saveGoogleReceipt(run.db, write(run))) && (await current(run))
      ? { kind: 'confirmed' }
      : { kind: 'stale' };
  } catch (error) {
    return await failed(run, error, resourceId);
  } finally {
    await releaseGoogleLease(run.db, run.lease);
  }
}
export async function syncGoogleOperation(
  db: Db,
  operationId: string,
  options: Options,
): Promise<GoogleSyncResult> {
  const now = options.now ?? (() => new Date()),
    maxGroups = options.maxGroups ?? 10;
  if (!Number.isInteger(maxGroups) || maxGroups < 1 || maxGroups > 100)
    throw new GoogleGroupsFailure('not_configured');
  const started = now();
  const job = await db
    .prepare(
      "SELECT person_id FROM integration_outbox WHERE id=? AND state IN ('queued','running','retry') AND next_attempt_at<=?",
    )
    .bind(operationId, started.toISOString())
    .first<{ person_id: string }>();
  if (!job) return { kind: 'stale' };
  const plan = await loadGooglePlan(db, {
    personId: job.person_id,
    operationId,
    customerId: options.client.configuration.customerId,
  });
  if (
    !plan ||
    plan.groups.some(
      (group) => !options.client.configuration.managedGroups.includes(group.resourceId),
    )
  )
    return { kind: 'not_ready' };
  const lease = await claimGoogleLease(db, plan, now());
  return lease
    ? await execute({ db, plan, lease, options, now, started, maxGroups })
    : { kind: 'busy' };
}
