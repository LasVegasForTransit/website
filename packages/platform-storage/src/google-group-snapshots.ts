import type { AccessFailure } from '@lasvegasfortransit/platform-core/access';
import type { Db, Statement } from './db';
import {
  parseGoogleSnapshot,
  googleGroupEmail,
  googleGroupKey,
  googleCheckDate,
} from './google-group-snapshot-input';
import {
  googleSnapshotWrites,
  GOOGLE_GROUP_REGISTERED,
  registeredValues,
} from './google-group-snapshot-writes';

interface Options {
  consoleGroupEmail: string | null;
  now: Date;
}
function validateOptions(options: Options): void {
  if (
    !Number.isFinite(options.now.getTime()) ||
    (options.consoleGroupEmail !== null && !googleGroupEmail(options.consoleGroupEmail))
  )
    throw new Error('Invalid Google group snapshot options');
}
function changed(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !('meta' in value)) return false;
  const meta = value.meta;
  return (
    !!meta &&
    typeof meta === 'object' &&
    'changes' in meta &&
    typeof meta.changes === 'number' &&
    meta.changes > 0
  );
}
export async function googleGroupRegistered(
  db: Db,
  groupEmail: string,
  consoleGroupEmail: string | null,
): Promise<boolean> {
  if (
    !googleGroupEmail(groupEmail) ||
    (consoleGroupEmail !== null && !googleGroupEmail(consoleGroupEmail))
  )
    return false;
  return !!(await db
    .prepare(`SELECT 1 AS found WHERE ${GOOGLE_GROUP_REGISTERED}`)
    .bind(...registeredValues(groupEmail, consoleGroupEmail))
    .first());
}
/** Atomically replace only a complete check. Provider contact profiles never reach SQL. */
export async function saveGoogleGroupSnapshot(
  db: Db,
  input: unknown,
  options: Options & { isCurrent(): Promise<boolean> },
): Promise<boolean> {
  validateOptions(options);
  const snapshot = await parseGoogleSnapshot(input, options.now);
  if (!(await options.isCurrent())) return false;
  const results = await db.batch(googleSnapshotWrites(db, snapshot, options.consoleGroupEmail));
  return changed(results[0]);
}
export async function recordGoogleGroupCheckFailure(
  db: Db,
  input: {
    customerId: string;
    groupEmail: string;
    failure: AccessFailure;
    startedAt: string;
  },
  options: Options,
): Promise<boolean> {
  validateOptions(options);
  if (
    !googleGroupKey(input.customerId) ||
    input.customerId === 'my_customer' ||
    !googleGroupEmail(input.groupEmail) ||
    !googleCheckDate(input.startedAt, options.now) ||
    !['provider_unavailable', 'rate_limited', 'permission_denied', 'unknown'].includes(
      input.failure,
    )
  )
    throw new Error('Invalid Google group check failure');
  const result = await db
    .prepare(
      `INSERT INTO google_group_check_failures(context_id,group_email,failure,started_at)
    SELECT ?,?,?,? WHERE ${GOOGLE_GROUP_REGISTERED} AND NOT EXISTS(SELECT 1 FROM google_group_inventory
      WHERE context_id=? AND group_email=? AND started_at>?)
    ON CONFLICT(context_id,group_email) DO UPDATE SET failure=excluded.failure,started_at=excluded.started_at
    WHERE excluded.started_at>=google_group_check_failures.started_at`,
    )
    .bind(
      input.customerId,
      input.groupEmail,
      input.failure,
      input.startedAt,
      ...registeredValues(input.groupEmail, options.consoleGroupEmail),
      input.customerId,
      input.groupEmail,
      input.startedAt,
    )
    .run();
  return result.meta.changes > 0;
}
export function googleGroupPruneWrites(db: Db, now: Date, limit = 10): Statement[] {
  const cutoff = new Date(now.getTime() - 86400000).toISOString();
  const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(10, Math.floor(limit))) : 10;
  const targets =
    'SELECT rowid FROM google_group_inventory WHERE observed_at<? ORDER BY observed_at,context_id,group_email LIMIT ?';
  return [
    db
      .prepare(`SELECT count(*) AS removed FROM google_group_inventory WHERE rowid IN (${targets})`)
      .bind(cutoff, bounded),
    db
      .prepare(`DELETE FROM google_group_inventory WHERE rowid IN (${targets})`)
      .bind(cutoff, bounded),
    db
      .prepare(
        'DELETE FROM google_group_check_failures WHERE rowid IN (SELECT rowid FROM google_group_check_failures WHERE started_at<? ORDER BY started_at LIMIT ?)',
      )
      .bind(cutoff, bounded),
  ];
}
export async function pruneGoogleGroupSnapshots(db: Db, now: Date, limit = 10): Promise<number> {
  const results = await db.batch(googleGroupPruneWrites(db, now, limit));
  const first = results[0];
  if (!first || typeof first !== 'object' || !('results' in first) || !Array.isArray(first.results))
    return 0;
  const row: unknown = first.results[0];
  return row && typeof row === 'object' && 'removed' in row && typeof row.removed === 'number'
    ? row.removed
    : 0;
}
