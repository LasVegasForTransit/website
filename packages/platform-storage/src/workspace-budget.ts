import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from './db';
import { queryBudget, type ScheduledWorkUsage } from './query-budget';
const RESERVE = { reads: 5000, writes: 500 };
function usage(value: unknown) {
  const meta = (value as { meta?: { rows_read?: number; rows_written?: number } } | null)?.meta;
  if (!meta) return null;
  const { rows_read: reads, rows_written: writes } = meta;
  return typeof reads === 'number' &&
    Number.isSafeInteger(reads) &&
    reads >= 0 &&
    typeof writes === 'number' &&
    Number.isSafeInteger(writes) &&
    writes >= 0
    ? { reads, writes }
    : null;
}
async function reserve(db: Db, environment: string, now: Date) {
  const token = randomToken(),
    day = now.toISOString().slice(0, 10);
  const caps =
    environment === 'production'
      ? { reads: 750000, writes: 25000 }
      : { reads: 75000, writes: 12000 };
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO workspace_connector_reservations(token,utc_day,reads,writes)
      SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM workspace_connector_budget)
       OR EXISTS(SELECT 1 FROM workspace_connector_budget WHERE utc_day<? OR (utc_day=? AND blocked=0 AND charged_reads+?<=? AND charged_writes+?<=?)) RETURNING token`,
      )
      .bind(
        token,
        day,
        RESERVE.reads,
        RESERVE.writes,
        day,
        day,
        RESERVE.reads,
        caps.reads,
        RESERVE.writes,
        caps.writes,
      ),
    db
      .prepare(
        `INSERT INTO workspace_connector_budget(id,utc_day,charged_reads,charged_writes)
      SELECT 1,utc_day,reads,writes FROM workspace_connector_reservations WHERE token=?
      ON CONFLICT(id) DO UPDATE SET utc_day=excluded.utc_day,charged_reads=CASE WHEN workspace_connector_budget.utc_day<excluded.utc_day THEN excluded.charged_reads ELSE charged_reads+excluded.charged_reads END,
      charged_writes=CASE WHEN workspace_connector_budget.utc_day<excluded.utc_day THEN excluded.charged_writes ELSE charged_writes+excluded.charged_writes END,
      blocked=CASE WHEN workspace_connector_budget.utc_day<excluded.utc_day THEN 0 ELSE blocked END`,
      )
      .bind(token),
  ]);
  const created = (results[0] as { results?: { token: string }[] }).results?.some(
    (row) => row.token === token,
  );
  const measured = results.map(usage);
  if (!created || measured.some((m) => m === null)) return null;
  return {
    token,
    day,
    reads: measured.reduce((n, m) => n + (m?.reads ?? 0), 0),
    writes: measured.reduce((n, m) => n + (m?.writes ?? 0), 0),
  };
}
async function settle(
  db: Db,
  lease: NonNullable<Awaited<ReturnType<typeof reserve>>>,
  measured: ScheduledWorkUsage,
  now: Date,
) {
  if (measured.quota_exhausted) return false;
  const bad = measured.metadata_missing > 0 || measured.database_errors > 0;
  const reads = measured.rows_read + lease.reads + 20,
    writes = measured.rows_written + lease.writes + 3;
  const blocked = bad || reads > RESERVE.reads || writes > RESERVE.writes;
  const accounting = await db.batch([
    db
      .prepare(
        `UPDATE workspace_connector_budget SET charged_reads=charged_reads-?+?,charged_writes=charged_writes-?+?,blocked=max(blocked,?)
      WHERE id=1 AND utc_day=? AND utc_day=? AND EXISTS(SELECT 1 FROM workspace_connector_reservations WHERE token=? AND utc_day=?)`,
      )
      .bind(
        RESERVE.reads,
        Math.max(reads, RESERVE.reads),
        RESERVE.writes,
        Math.max(writes, RESERVE.writes),
        Number(blocked),
        lease.day,
        now.toISOString().slice(0, 10),
        lease.token,
        lease.day,
      ),
    db.prepare('DELETE FROM workspace_connector_reservations WHERE token=?').bind(lease.token),
  ]);
  const costs = accounting.map(usage);
  if (blocked || !controlCost(costs, 10, 2)) {
    await db
      .prepare('UPDATE workspace_connector_budget SET blocked=1 WHERE id=1 AND utc_day=?')
      .bind(lease.day)
      .run();
    return false;
  }
  const released = await db
    .prepare(
      `UPDATE workspace_connector_budget SET charged_reads=charged_reads-?,charged_writes=charged_writes-?
    WHERE id=1 AND utc_day=? AND blocked=0 RETURNING id`,
    )
    .bind(
      Math.max(reads, RESERVE.reads) - reads,
      Math.max(writes, RESERVE.writes) - writes,
      lease.day,
    )
    .all();
  if (!controlCost([usage(released)], 10, 1)) {
    await db
      .prepare('UPDATE workspace_connector_budget SET blocked=1 WHERE id=1 AND utc_day=?')
      .bind(lease.day)
      .run();
    return false;
  }
  return released.results.length > 0;
}
function controlCost(costs: ReturnType<typeof usage>[], reads: number, writes: number) {
  return (
    costs.every((c) => c !== null) &&
    costs.reduce((n, c) => n + c.reads, 0) <= reads &&
    costs.reduce((n, c) => n + c.writes, 0) <= writes
  );
}
export async function workspaceBudget<T>(
  db: Db,
  environment: string,
  run: (db: Db) => Promise<T>,
  now: Date,
): Promise<{ allowed: true; result: T } | { allowed: false }> {
  const lease = await reserve(db, environment, now);
  if (!lease) return { allowed: false };
  const budget = queryBudget(db, 300, { strictRows: true });
  let result: T;
  try {
    result = await run(budget.db);
  } catch {
    await settle(db, lease, budget.usage, now);
    return { allowed: false };
  }
  return (await settle(db, lease, budget.usage, now))
    ? { allowed: true, result }
    : { allowed: false };
}
