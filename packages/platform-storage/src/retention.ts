import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db } from './db';
import { personRetentionWrites } from './person-retention';
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
/** Bounded per category. Scope, deletion and scope removal commit or roll back together. */
export async function runMaintenance(
  db: Db,
  options: { now?: Date; limit?: number } = {},
): Promise<MaintenanceResult> {
  const now = options.now ?? new Date();
  const stamp = now.toISOString();
  const viewsBefore = yearsBefore(now, 1),
    auditsBefore = yearsBefore(now, 3);
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(1000, Math.floor(options.limit ?? 100)))
    : 100;
  const result = await db.batch([
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
    ...personRetentionWrites(db, {
      operationId: ulid(),
      stamp,
      limit,
      deletedBefore: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
    }),
    db.prepare('DELETE FROM audit_retention_scope WHERE id=1'),
  ]);
  return {
    viewsRemoved: changed(result[1]),
    auditsRemoved: changed(result[2]),
    claimsExpired: changed(result[3]),
    profilesErased: erasedCount(result[5]),
    profilesRemoved: changed(result.at(-3)),
  };
}
