import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db, Statement } from './db';
import { personRetentionWrites, inactivePersonRetentionWrites } from './person-retention';
import { memberPrivacySchedule } from './member-privacy-schedule';
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
function profileCount(result: unknown, key: 'profiles_erased' | 'profiles_removed'): number {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('results' in result) ||
    !Array.isArray(result.results)
  )
    return 0;
  const row: unknown = result.results[0];
  if (typeof row !== 'object' || row === null) return 0;
  const count: unknown = Object.entries(row).find(([name]) => name === key)?.[1];
  return typeof count === 'number' ? count : 0;
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
async function runInactiveMaintenance(
  db: Db,
  now: Date,
  limit: number,
): Promise<MaintenanceResult> {
  const schedule = memberPrivacySchedule(now);
  const complete =
    schedule &&
    (await db
      .prepare('SELECT 1 FROM member_privacy_runs WHERE local_day=? AND completed_at IS NOT NULL')
      .bind(schedule.day)
      .first());
  const result =
    schedule && !complete
      ? await db.batch(
          await inactivePersonRetentionWrites(db, {
            ...schedule,
            operationId: ulid(),
            stamp: now.toISOString(),
            limit,
          }),
        )
      : [];
  return {
    viewsRemoved: 0,
    auditsRemoved: 0,
    claimsExpired: 0,
    profilesRemoved: 0,
    profilesErased: profileCount(result[2], 'profiles_erased'),
  };
}
/** Each selected category commits its scope, cleanup and scope removal atomically. */
export async function runMaintenance(
  db: Db,
  options: {
    now?: Date;
    limit?: number;
    category?: 'all' | 'records' | 'profiles' | 'inactive';
  } = {},
): Promise<MaintenanceResult> {
  const now = options.now ?? new Date();
  const stamp = now.toISOString();
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(1000, Math.floor(options.limit ?? 100)))
    : 100;
  if (options.category === 'inactive') return await runInactiveMaintenance(db, now, limit);
  const records = options.category === 'profiles' ? [] : recordMaintenanceWrites(db, now, limit);
  const profiles =
    options.category === 'records'
      ? []
      : await personRetentionWrites(db, {
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
    profilesErased: profiles.length
      ? profileCount(result[records.length + 1], 'profiles_erased')
      : 0,
    profilesRemoved: profiles.length
      ? profileCount(result[records.length + profiles.length - 3], 'profiles_removed')
      : 0,
  };
}
