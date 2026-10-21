import type { Db } from './db';

export const SCHEDULED_RESERVATION = { reads: 50_000, writes: 4_000 };
// Both settlement statements touch one singleton primary-key row; charge their allowance before release.
export const SCHEDULED_CONTROL_ALLOWANCE = { reads: 8, writes: 8 };
export interface ScheduledWorkLease {
  token: string;
  day: string;
  guardReads: number;
  guardWrites: number;
  metadataMissing: number;
}
export interface ScheduledWorkUsage {
  rows_read: number;
  rows_written: number;
  metadata_missing: number;
  database_errors: number;
  quota_exhausted: boolean;
}
function metadata(result: unknown): { reads: number; writes: number; missing: number } {
  if (
    typeof result === 'object' &&
    result !== null &&
    'meta' in result &&
    typeof result.meta === 'object' &&
    result.meta !== null
  ) {
    const meta = result.meta;
    const reads = 'rows_read' in meta ? meta.rows_read : undefined;
    const writes = 'rows_written' in meta ? meta.rows_written : undefined;
    if (
      typeof reads === 'number' &&
      Number.isSafeInteger(reads) &&
      reads >= 0 &&
      typeof writes === 'number' &&
      Number.isSafeInteger(writes) &&
      writes >= 0
    )
      return { reads, writes, missing: 0 };
  }
  return { reads: 0, writes: 0, missing: 1 };
}
export async function reserveScheduledWork(
  db: Db,
  environment: string,
  now: Date,
  token: string,
): Promise<ScheduledWorkLease | null> {
  const day = now.toISOString().slice(0, 10);
  const caps =
    environment === 'production'
      ? { reads: 2_000_000, writes: 45_000 }
      : { reads: 250_000, writes: 5_000 };
  const result = await db
    .prepare(
      `INSERT INTO scheduled_work_budget(id,utc_day,charged_reads,charged_writes,lease_token,lease_until,blocked)
    VALUES(1,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET
      utc_day=excluded.utc_day,
      charged_reads=CASE WHEN scheduled_work_budget.utc_day<excluded.utc_day THEN excluded.charged_reads ELSE scheduled_work_budget.charged_reads+excluded.charged_reads END,
      charged_writes=CASE WHEN scheduled_work_budget.utc_day<excluded.utc_day THEN excluded.charged_writes ELSE scheduled_work_budget.charged_writes+excluded.charged_writes END,
      lease_token=excluded.lease_token,lease_until=excluded.lease_until,blocked=0
    WHERE scheduled_work_budget.lease_until<=? AND
      (scheduled_work_budget.utc_day<excluded.utc_day OR
        (scheduled_work_budget.utc_day=excluded.utc_day AND scheduled_work_budget.blocked=0
          AND scheduled_work_budget.charged_reads+excluded.charged_reads<=?
          AND scheduled_work_budget.charged_writes+excluded.charged_writes<=?)) RETURNING lease_token`,
    )
    .bind(
      day,
      SCHEDULED_RESERVATION.reads,
      SCHEDULED_RESERVATION.writes,
      token,
      new Date(now.getTime() + 120_000).toISOString(),
      now.toISOString(),
      caps.reads,
      caps.writes,
    )
    .all();
  const measured = metadata(result);
  const admitted = result.results.length > 0;
  console.log(
    JSON.stringify({
      event: 'scheduled_budget_guard',
      admitted,
      rows_read: measured.reads,
      rows_written: measured.writes,
      metadata_missing: measured.missing,
    }),
  );
  return admitted
    ? {
        token,
        day,
        guardReads: measured.reads,
        guardWrites: measured.writes,
        metadataMissing: measured.missing,
      }
    : null;
}

export async function settleScheduledWork(
  db: Db,
  lease: ScheduledWorkLease,
  usage: ScheduledWorkUsage,
  options: { failed: boolean; now: Date },
): Promise<void> {
  const { failed, now } = options;
  const valid = [
    usage.rows_read,
    usage.rows_written,
    usage.metadata_missing,
    usage.database_errors,
  ].every((count) => Number.isSafeInteger(count) && count >= 0);
  const actualReads = valid
    ? usage.rows_read + lease.guardReads + SCHEDULED_CONTROL_ALLOWANCE.reads
    : SCHEDULED_RESERVATION.reads;
  const actualWrites = valid
    ? usage.rows_written + lease.guardWrites + SCHEDULED_CONTROL_ALLOWANCE.writes
    : SCHEDULED_RESERVATION.writes;
  const blocked = [
    failed,
    !valid,
    lease.metadataMissing > 0,
    usage.metadata_missing > 0,
    usage.database_errors > 0,
    usage.quota_exhausted,
    actualReads > SCHEDULED_RESERVATION.reads,
    actualWrites > SCHEDULED_RESERVATION.writes,
  ].some(Boolean);
  const reads = Math.max(actualReads, SCHEDULED_RESERVATION.reads);
  const writes = Math.max(actualWrites, SCHEDULED_RESERVATION.writes);
  const pendingToken = `settling:${lease.token}`;
  const result = await db
    .prepare(
      `UPDATE scheduled_work_budget SET
    charged_reads=charged_reads-?+?,charged_writes=charged_writes-?+?,
    blocked=1,lease_token=? WHERE id=1 AND utc_day=? AND lease_token=? AND utc_day=? RETURNING id`,
    )
    .bind(
      SCHEDULED_RESERVATION.reads,
      reads,
      SCHEDULED_RESERVATION.writes,
      writes,
      pendingToken,
      lease.day,
      lease.token,
      now.toISOString().slice(0, 10),
    )
    .all();
  const measured = metadata(result);
  console.log(
    JSON.stringify({
      event: 'scheduled_budget_accounted',
      matched: result.results.length > 0,
      blocked: true,
      rows_read: measured.reads,
      rows_written: measured.writes,
      metadata_missing: measured.missing,
    }),
  );
  if (!result.results.length) return;
  if (!verifiedControlCost(measured))
    throw new Error('Scheduled budget settlement accounting failed');
  if (blocked) return;
  await releaseVerifiedBudget(db, lease, {
    pendingToken,
    reads: actualReads,
    writes: actualWrites,
    now,
  });
}

function verifiedControlCost(measured: ReturnType<typeof metadata>): boolean {
  return (
    measured.missing === 0 &&
    measured.reads <= SCHEDULED_CONTROL_ALLOWANCE.reads / 2 &&
    measured.writes <= SCHEDULED_CONTROL_ALLOWANCE.writes / 2
  );
}

async function releaseVerifiedBudget(
  db: Db,
  lease: ScheduledWorkLease,
  release: { pendingToken: string; reads: number; writes: number; now: Date },
): Promise<void> {
  try {
    const result = await db
      .prepare(
        `UPDATE scheduled_work_budget SET
      charged_reads=charged_reads-?+?,charged_writes=charged_writes-?+?,
      blocked=0,lease_token='',lease_until=? WHERE id=1 AND utc_day=? AND lease_token=? AND blocked=1 AND utc_day=? RETURNING id`,
      )
      .bind(
        SCHEDULED_RESERVATION.reads,
        release.reads,
        SCHEDULED_RESERVATION.writes,
        release.writes,
        release.now.toISOString(),
        lease.day,
        release.pendingToken,
        release.now.toISOString().slice(0, 10),
      )
      .all();
    const measured = metadata(result);
    if (result.results.length && !verifiedControlCost(measured))
      throw new Error('Unverified release response');
    console.log(
      JSON.stringify({
        event: 'scheduled_budget_settled',
        matched: result.results.length > 0,
        blocked: false,
        rows_read: measured.reads,
        rows_written: measured.writes,
        metadata_missing: measured.missing,
      }),
    );
  } catch {
    // A lost acknowledgment may follow a committed release. Its fixed cost was already charged.
    console.log(JSON.stringify({ event: 'scheduled_budget_release_uncertain' }));
    throw new Error('Scheduled budget release acknowledgment unavailable');
  }
}
