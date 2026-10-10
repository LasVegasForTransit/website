import type { AccessFailure } from '@lasvegasfortransit/platform-core/access';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { operationIsCurrent } from '@lasvegasfortransit/platform-storage/outbox';
import {
  loadDiscordPlan,
  discordPlanIsCurrent,
  type DiscordPlan,
} from '@lasvegasfortransit/platform-storage/discord-plan';
import {
  claimDiscordLease,
  renewDiscordLease,
  releaseDiscordLease,
  saveDiscordSync,
  type DiscordLease,
} from '@lasvegasfortransit/platform-storage/discord-sync-store';
import { type DiscordAccess, DiscordApiFailure } from './discord-access';
import {
  prepareDiscordChange,
  confirmDiscordChanges,
} from '@lasvegasfortransit/platform-storage/discord-change-audit';
interface SyncOptions {
  client: DiscordAccess;
  memberRoleId: string;
  now?: () => Date;
}
export type DiscordSyncResult =
  | { kind: 'confirmed' | 'stale' | 'busy' | 'not_ready' }
  | { kind: 'retry'; failure: AccessFailure; retryAfterMs: number };
interface Run {
  db: Db;
  operationId: string;
  plan: DiscordPlan;
  lease: DiscordLease;
  options: SyncOptions;
  now: () => Date;
}
async function current(run: Run): Promise<boolean> {
  return (
    (await operationIsCurrent(run.db, run.operationId)) &&
    (await discordPlanIsCurrent(run.db, run.plan)) &&
    (await renewDiscordLease(run.db, run.lease, run.now()))
  );
}
function failure(error: unknown): { failure: AccessFailure; retryAfterMs: number } {
  if (!(error instanceof DiscordApiFailure)) return { failure: 'unknown', retryAfterMs: 60_000 };
  const kind = error.kind;
  const known: AccessFailure =
    kind === 'provider_unavailable' || kind === 'rate_limited' || kind === 'permission_denied'
      ? kind
      : 'unknown';
  return { failure: known, retryAfterMs: error.retryAfterMs ?? 60_000 };
}
async function execute(run: Run): Promise<DiscordSyncResult> {
  try {
    const member = await run.options.client.reconcile({
      identityId: run.plan.identityId,
      managedRoleIds: run.plan.managedRoleIds,
      desiredRoleIds: run.plan.desiredRoleIds,
      operationId: run.operationId,
      isCurrent: async () => await current(run),
      journal: {
        prepare: async (change) =>
          await prepareDiscordChange(
            run.db,
            {
              operationId: run.operationId,
              plan: run.plan,
              lease: run.lease,
              now: run.now(),
            },
            change,
          ),
        observe: async (member) =>
          await confirmDiscordChanges(run.db, {
            operationId: run.operationId,
            plan: run.plan,
            lease: run.lease,
            now: run.now(),
            member,
          }),
      },
    });
    const saved = await saveDiscordSync(run.db, {
      operationId: run.operationId,
      plan: run.plan,
      lease: run.lease,
      now: run.now(),
      member,
    });
    return saved && (await current(run)) ? { kind: 'confirmed' } : { kind: 'stale' };
  } catch (error) {
    if (!(await current(run))) return { kind: 'stale' };
    const retry = failure(error);
    const saved = await saveDiscordSync(run.db, {
      operationId: run.operationId,
      plan: run.plan,
      lease: run.lease,
      now: run.now(),
      ...retry,
    });
    return saved && (await current(run)) ? { kind: 'retry', ...retry } : { kind: 'stale' };
  } finally {
    await releaseDiscordLease(run.db, run.lease);
  }
}
/** Reconcile Discord only; Google and mailing-list completion have independent receipts. */
export async function syncDiscordOperation(
  db: Db,
  operationId: string,
  options: SyncOptions,
): Promise<DiscordSyncResult> {
  const now = options.now ?? (() => new Date());
  const job = await db
    .prepare(
      "SELECT person_id AS personId FROM integration_outbox WHERE id=? AND kind IN ('person_reconcile','committee_reconcile') AND state IN ('queued','running','retry') AND next_attempt_at<=?",
    )
    .bind(operationId, now().toISOString())
    .first<{ personId: string }>();
  if (!job || !(await operationIsCurrent(db, operationId))) return { kind: 'stale' };
  const plan = await loadDiscordPlan(db, {
    personId: job.personId,
    guildId: options.client.configuration.guildId,
    memberRoleId: options.memberRoleId,
    operationId,
  });
  if (!plan) return { kind: 'not_ready' };
  const lease = await claimDiscordLease(db, plan, now());
  if (!lease) return { kind: 'busy' };
  return await execute({ db, operationId, plan, lease, options, now });
}
