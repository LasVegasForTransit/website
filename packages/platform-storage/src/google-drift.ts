import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db, SqlValue } from './db';

interface Options {
  customerId: string;
  limit?: number;
  now?: () => Date;
}
interface GoogleScanLease {
  customerId: string;
  token: string;
  startedAt: string;
  cursor: string | null;
}
export interface GoogleDriftResult {
  kind: 'scanned' | 'idle' | 'busy' | 'stale';
  scanned: number;
  queued: number;
  complete: boolean;
}

const ELIGIBLE = `p.deleted_at IS NULL AND
  (SELECT count(*) FROM identities WHERE person_id=p.id AND platform='google_workspace')=1 AND
  EXISTS(SELECT 1 FROM identities WHERE person_id=p.id AND platform='google_workspace' AND link_method IN ('self_linked','staff_confirmed'))`;
const SCAN_CURRENT = `EXISTS(SELECT 1 FROM provider_scan_checkpoints
  WHERE provider='google_workspace' AND context_id=? AND lease_token=? AND lease_expires_at>?
  AND in_progress=1 AND cursor IS ? AND started_at=?)`;

function scanValues(scan: GoogleScanLease, now: Date): SqlValue[] {
  return [scan.customerId, scan.token, now.toISOString(), scan.cursor, scan.startedAt];
}

function changes(result: unknown): number {
  if (typeof result !== 'object' || result === null || !('meta' in result)) return 0;
  const meta = result.meta;
  if (typeof meta !== 'object' || meta === null || !('changes' in meta)) return 0;
  return typeof meta.changes === 'number' ? meta.changes : 0;
}

async function claimScan(
  db: Db,
  customerId: string,
  now: Date,
): Promise<GoogleScanLease | 'idle' | 'busy'> {
  const token = randomToken();
  const stamp = now.toISOString();
  const nextHour = new Date(
    Math.floor(now.getTime() / 3_600_000) * 3_600_000 + 3_600_000,
  ).toISOString();
  const result = await db
    .prepare(
      `INSERT INTO provider_scan_checkpoints(provider,context_id,started_at,next_scan_at,in_progress,lease_token,lease_expires_at)
    VALUES('google_workspace',?,?,?,1,?,?) ON CONFLICT(provider,context_id) DO UPDATE SET
      started_at=CASE WHEN in_progress=1 THEN started_at ELSE excluded.started_at END,
      next_scan_at=CASE WHEN in_progress=1 THEN next_scan_at ELSE excluded.next_scan_at END,
      cursor=CASE WHEN in_progress=1 THEN cursor ELSE NULL END,in_progress=1,
      lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at
    WHERE (lease_expires_at IS NULL OR lease_expires_at<=?) AND (in_progress=1 OR next_scan_at<=?)`,
    )
    .bind(
      customerId,
      stamp,
      nextHour,
      token,
      new Date(now.getTime() + 30_000).toISOString(),
      stamp,
      stamp,
    )
    .run();
  if (!result.meta.changes) {
    const row = await db
      .prepare(
        "SELECT in_progress,next_scan_at FROM provider_scan_checkpoints WHERE provider='google_workspace' AND context_id=?",
      )
      .bind(customerId)
      .first<{ in_progress: number; next_scan_at: string }>();
    return row?.in_progress === 0 && row.next_scan_at > stamp ? 'idle' : 'busy';
  }
  const row = await db
    .prepare(
      "SELECT started_at,cursor FROM provider_scan_checkpoints WHERE provider='google_workspace' AND context_id=? AND lease_token=?",
    )
    .bind(customerId, token)
    .first<{ started_at: string; cursor: string | null }>();
  return row ? { customerId, token, startedAt: row.started_at, cursor: row.cursor } : 'busy';
}

async function releaseScan(db: Db, scan: GoogleScanLease): Promise<void> {
  await db
    .prepare(
      "UPDATE provider_scan_checkpoints SET lease_token=NULL,lease_expires_at=NULL WHERE provider='google_workspace' AND context_id=? AND lease_token=?",
    )
    .bind(scan.customerId, scan.token)
    .run();
}

async function advance(
  db: Db,
  scan: GoogleScanLease,
  page: { ids: string[]; more: boolean },
  now: Date,
): Promise<GoogleDriftResult> {
  const { ids, more } = page;
  const selected = JSON.stringify(ids);
  const stamp = now.toISOString();
  const guard = scanValues(scan, now);
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO reconcile_generations(person_id,target_id,generation)
      SELECT p.id,'person',1 FROM people p JOIN json_each(?) chosen ON chosen.value=p.id
      WHERE ${ELIGIBLE} AND ${SCAN_CURRENT} ON CONFLICT(person_id,target_id) DO NOTHING`,
      )
      .bind(selected, ...guard),
    db
      .prepare(
        `INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
      SELECT ? || ':' || p.id || ':' || g.generation,'person_reconcile',p.id,'person',g.generation,?,?,?,?
      FROM people p JOIN json_each(?) chosen ON chosen.value=p.id JOIN reconcile_generations g ON g.person_id=p.id AND g.target_id='person'
      WHERE ${ELIGIBLE} AND ${SCAN_CURRENT}
      AND NOT EXISTS(SELECT 1 FROM integration_outbox o JOIN reconcile_generations current ON current.person_id=o.person_id AND current.target_id=o.target_id AND current.generation=o.generation
        WHERE o.person_id=p.id AND o.kind IN ('person_reconcile','committee_reconcile') AND o.state IN ('queued','running','retry'))
      ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        `google-drift:${scan.customerId}:${scan.startedAt}`,
        JSON.stringify({ source: 'google_drift', customerId: scan.customerId }),
        stamp,
        stamp,
        stamp,
        selected,
        ...guard,
      ),
    db
      .prepare(
        `UPDATE provider_scan_checkpoints SET cursor=?,in_progress=?,last_completed_at=CASE WHEN ?=0 THEN ? ELSE last_completed_at END,lease_token=NULL,lease_expires_at=NULL WHERE provider='google_workspace' AND context_id=? AND ${SCAN_CURRENT}`,
      )
      .bind(
        more ? (ids.at(-1) ?? scan.cursor) : null,
        Number(more),
        Number(more),
        stamp,
        scan.customerId,
        ...guard,
      ),
  ]);
  return changes(result[2])
    ? {
        kind: 'scanned',
        scanned: ids.length,
        queued: changes(result[1]),
        complete: !more,
      }
    : { kind: 'stale', scanned: 0, queued: 0, complete: false };
}

/** Revisit verified Workspace links, including former members, once each UTC hour. */
export async function queueGoogleDrift(db: Db, options: Options): Promise<GoogleDriftResult> {
  const limit = options.limit ?? 100;
  const now = options.now ?? (() => new Date());
  const started = now();
  if (
    typeof options.customerId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(options.customerId) ||
    options.customerId === 'my_customer' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isFinite(started.getTime())
  )
    throw new Error('Invalid Google scan configuration');
  const scan = await claimScan(db, options.customerId, started);
  if (typeof scan === 'string') return { kind: scan, scanned: 0, queued: 0, complete: false };
  try {
    const { results } = await db
      .prepare(`SELECT p.id FROM people p WHERE ${ELIGIBLE} AND p.id>? ORDER BY p.id LIMIT ?`)
      .bind(scan.cursor ?? '', limit + 1)
      .all<{ id: string }>();
    return await advance(
      db,
      scan,
      { ids: results.slice(0, limit).map((row) => row.id), more: results.length > limit },
      now(),
    );
  } finally {
    await releaseScan(db, scan);
  }
}
