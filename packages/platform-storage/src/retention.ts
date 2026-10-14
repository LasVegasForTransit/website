import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db, Statement } from './db';
import { personRetentionWrites } from './person-retention';
import { googleGroupPruneWrites } from './google-group-snapshots';
export interface MaintenanceResult {
  viewsRemoved: number;
  auditsRemoved: number;
  claimsExpired: number;
  profilesErased: number;
  profilesRemoved: number;
}
function yearsBefore(now: Date, years: number): string {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return cutoff.toISOString();
}
function changed(result: unknown): number {
  if (typeof result !== 'object' || result === null || !('meta' in result)) return 0;
  const meta = result.meta;
  if (typeof meta !== 'object' || meta === null || !('changes' in meta)) return 0;
  return typeof meta.changes === 'number' ? meta.changes : 0;
}
/** D1 change counts include trigger writes; count scoped profiles explicitly. */
function erasedCount(result: unknown): number {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('results' in result) ||
    !Array.isArray(result.results)
  )
    return 0;
  const row: unknown = result.results[0];
  return typeof row === 'object' &&
    row !== null &&
    'profiles_erased' in row &&
    typeof row.profiles_erased === 'number'
    ? row.profiles_erased
    : 0;
}
function recordMaintenanceWrites(db: Db, now: Date, limit: number): Statement[] {
  const stamp = now.toISOString();
  const viewsBefore = yearsBefore(now, 1),
    auditsBefore = yearsBefore(now, 3);
  return [
    db
      .prepare(
        'INSERT INTO audit_retention_scope(id,run_at,views_before,audits_before) VALUES(1,?,?,?)',
      )
      .bind(stamp, viewsBefore, auditsBefore),
    db
      .prepare(
        'DELETE FROM person_views WHERE id IN (SELECT id FROM person_views WHERE occurred_at<? ORDER BY occurred_at,id LIMIT ?)',
      )
      .bind(viewsBefore, limit),
    db
      .prepare(
        'DELETE FROM staff_audits WHERE id IN (SELECT id FROM staff_audits WHERE occurred_at<? ORDER BY occurred_at,id LIMIT ?)',
      )
      .bind(auditsBefore, limit),
    db
      .prepare(
        'DELETE FROM welcome_claims WHERE id IN (SELECT id FROM welcome_claims WHERE expires_at<=? ORDER BY expires_at,id LIMIT ?)',
      )
      .bind(stamp, limit),
    ...googleGroupPruneWrites(db, now, limit),
  ];
}
/** Each selected category commits its scope, cleanup and scope removal atomically. */
export async function runMaintenance(
  db: Db,
  options: { now?: Date; limit?: number; category?: 'all' | 'records' | 'profiles' } = {},
): Promise<MaintenanceResult> {
  const now = options.now ?? new Date();
  const stamp = now.toISOString();
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(1000, Math.floor(options.limit ?? 100)))
    : 100;
  const records = options.category === 'profiles' ? [] : recordMaintenanceWrites(db, now, limit);
  const profiles =
    options.category === 'records'
      ? []
      : personRetentionWrites(db, {
          operationId: ulid(),
          stamp,
          limit,
          deletedBefore: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
        });
  const result = await db.batch([
    ...records,
    ...profiles,
    ...(records.length ? [db.prepare('DELETE FROM audit_retention_scope WHERE id=1')] : []),
  ]);
  return {
    viewsRemoved: records.length ? changed(result[1]) : 0,
    auditsRemoved: records.length ? changed(result[2]) : 0,
    claimsExpired: records.length ? changed(result[3]) : 0,
    profilesErased: profiles.length ? erasedCount(result[records.length + 1]) : 0,
    profilesRemoved: profiles.length ? changed(result[records.length + profiles.length - 2]) : 0,
  };
}
