import type { Db } from './db';
import { workScopeKey, type WorkScope } from './discord-work-types';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditedTaskCheckinChange } from './notion-task-admin-audit';

export interface WorkRouteScan {
  route_id: string;
  scope_key: string;
  revision: number;
  mode: 'scan' | 'baseline';
  cursor: string | null;
  claim_token: string;
  lease_expires_at: string;
}

/** Start a new, non-provisioning pass for a particular paused route revision. */
export async function requestWorkRouteBaseline(
  db: Db,
  actor: { personId: string },
  input: { scope: WorkScope; routeId: string; revision: number },
  now: Date,
): Promise<boolean> {
  const { scope, routeId, revision } = input;
  const stamp = now.toISOString();
  const mutation = db
    .prepare(
      `INSERT INTO discord_work_route_scans(route_id,scope_key,revision,mode,baseline_completed_at,cursor,claim_token,lease_expires_at,next_attempt_at,updated_at)
    SELECT r.id,r.scope_key,r.revision,'baseline',NULL,NULL,NULL,NULL,?,? FROM discord_work_routes r WHERE r.id=? AND r.scope_key=? AND r.state='paused' AND r.revision=? AND ${STAFF_ADMIN_SCOPE}
    ON CONFLICT(route_id) DO UPDATE SET revision=excluded.revision,mode='baseline',baseline_completed_at=NULL,last_error=NULL,last_success_at=NULL,cursor=NULL,claim_token=NULL,lease_expires_at=NULL,next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at
    WHERE discord_work_route_scans.claim_token IS NULL OR discord_work_route_scans.lease_expires_at<=?`,
    )
    .bind(stamp, stamp, routeId, workScopeKey(scope), revision, actor.personId, stamp);
  return auditedTaskCheckinChange(db, actor, {
    mutation,
    action: 'discord_work.prepare_route',
    targetId: routeId,
    now,
  });
}
export async function readWorkRouteBaseline(
  db: Db,
  scope: WorkScope,
  routeId: string,
  revision: number,
): Promise<boolean> {
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM discord_work_route_scans s JOIN discord_work_routes r ON r.id=s.route_id AND r.scope_key=s.scope_key
    WHERE s.route_id=? AND s.scope_key=? AND s.revision=? AND s.mode='baseline' AND s.cursor IS NULL AND s.baseline_completed_at IS NOT NULL AND r.state='paused' AND r.revision=s.revision`,
      )
      .bind(routeId, workScopeKey(scope), revision)
      .first(),
  );
}

/** Claim one bounded page of an active route. Expired leases resume the same cursor. */
export async function claimWorkRouteScan(
  db: Db,
  scope: WorkScope,
  now: Date,
): Promise<WorkRouteScan | null> {
  const key = workScopeKey(scope),
    stamp = now.toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO discord_work_route_scans(route_id,scope_key,revision,cursor,next_attempt_at,updated_at)
    SELECT r.id,r.scope_key,r.revision,NULL,?,? FROM discord_work_routes r WHERE r.scope_key=? AND r.state='active'
    AND NOT EXISTS(SELECT 1 FROM discord_work_route_scans s WHERE s.route_id=r.id) ORDER BY r.id LIMIT 1`,
    )
    .bind(stamp, stamp, key)
    .run();
  return db
    .prepare(
      `UPDATE discord_work_route_scans AS s SET
    cursor=CASE WHEN revision<>(SELECT revision FROM discord_work_routes WHERE id=s.route_id) THEN NULL ELSE cursor END,
    revision=(SELECT revision FROM discord_work_routes WHERE id=s.route_id),claim_token=?,lease_expires_at=?,updated_at=?
    WHERE route_id=(SELECT scan.route_id FROM discord_work_route_scans scan JOIN discord_work_routes route ON route.id=scan.route_id AND route.scope_key=scan.scope_key
      WHERE scan.scope_key=? AND ((route.state='active' AND scan.mode='scan') OR (route.state='paused' AND scan.mode='baseline' AND scan.revision=route.revision AND scan.baseline_completed_at IS NULL)) AND scan.next_attempt_at<=? AND (scan.claim_token IS NULL OR scan.lease_expires_at<=?)
      ORDER BY scan.next_attempt_at,scan.route_id LIMIT 1) RETURNING *`,
    )
    .bind(
      crypto.randomUUID(),
      new Date(now.getTime() + 60_000).toISOString(),
      stamp,
      key,
      stamp,
      stamp,
    )
    .first<WorkRouteScan>();
}

export async function completeWorkRouteScanPage(
  db: Db,
  claim: WorkRouteScan,
  nextCursor: string | null,
  now: Date,
): Promise<boolean> {
  if (nextCursor !== null && (!nextCursor || nextCursor.length > 2048)) return false;
  const stamp = now.toISOString();
  const result = await db
    .prepare(
      `UPDATE discord_work_route_scans SET cursor=?,claim_token=NULL,lease_expires_at=NULL,next_attempt_at=?,updated_at=?,last_error=NULL,last_success_at=?,baseline_completed_at=CASE WHEN mode='baseline' AND ? IS NULL THEN ? ELSE baseline_completed_at END
    WHERE route_id=? AND scope_key=? AND revision=? AND claim_token=? AND lease_expires_at>?
    AND EXISTS(SELECT 1 FROM discord_work_routes r WHERE r.id=discord_work_route_scans.route_id AND r.scope_key=discord_work_route_scans.scope_key AND ((r.state='active' AND discord_work_route_scans.mode='scan') OR (r.state='paused' AND discord_work_route_scans.mode='baseline')) AND r.revision=?)`,
    )
    .bind(
      nextCursor,
      new Date(now.getTime() + (nextCursor === null ? 900_000 : 0)).toISOString(),
      stamp,
      stamp,
      nextCursor,
      stamp,
      claim.route_id,
      claim.scope_key,
      claim.revision,
      claim.claim_token,
      stamp,
      claim.revision,
    )
    .run();
  return result.meta.changes > 0;
}

export async function deferWorkRouteScan(db: Db, claim: WorkRouteScan, now: Date): Promise<void> {
  await db
    .prepare(
      "UPDATE discord_work_route_scans SET claim_token=NULL,lease_expires_at=NULL,next_attempt_at=?,updated_at=?,last_error='source_unavailable' WHERE route_id=? AND scope_key=? AND revision=? AND claim_token=? AND lease_expires_at>? AND EXISTS(SELECT 1 FROM discord_work_routes r WHERE r.id=discord_work_route_scans.route_id AND r.scope_key=discord_work_route_scans.scope_key AND r.revision=discord_work_route_scans.revision AND ((r.state='active' AND discord_work_route_scans.mode='scan') OR (r.state='paused' AND discord_work_route_scans.mode='baseline')))",
    )
    .bind(
      new Date(now.getTime() + 60_000).toISOString(),
      now.toISOString(),
      claim.route_id,
      claim.scope_key,
      claim.revision,
      claim.claim_token,
      now.toISOString(),
    )
    .run();
}
