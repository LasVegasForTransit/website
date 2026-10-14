import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db, SqlValue } from './db';

export interface BeehiivPollLease {
  publicationId: string;
  token: string;
  startedAt: string;
  cursor: string | null;
}
export interface BeehiivPollObservation {
  id: string;
  status: string;
  created: number;
}
export class InvalidBeehiivPollPage extends Error {}
export type BeehiivPollFailure = 'provider_error' | 'invalid_response' | 'transport';

const CURRENT = `EXISTS(SELECT 1 FROM beehiiv_poll_checkpoints
  WHERE publication_id=? AND lease_token=? AND lease_expires_at>?
  AND cursor IS ? AND started_at=? AND in_progress=1)`;
function values(scan: BeehiivPollLease, now: Date): SqlValue[] {
  return [scan.publicationId, scan.token, now.toISOString(), scan.cursor, scan.startedAt];
}

export async function claimBeehiivPoll(
  db: Db,
  publicationId: string,
  now: Date,
): Promise<BeehiivPollLease | 'idle' | 'busy'> {
  if (!/^pub_[A-Za-z0-9_-]{1,124}$/.test(publicationId) || !Number.isFinite(now.getTime()))
    throw new Error('Invalid Beehiiv poll configuration');
  const token = randomToken(),
    stamp = now.toISOString();
  const nextScan = new Date(now.getTime() + 15 * 60_000).toISOString();
  const result = await db
    .prepare(
      `INSERT INTO beehiiv_poll_checkpoints(publication_id,started_at,next_scan_at,next_attempt_at,in_progress,lease_token,lease_expires_at)
    VALUES(?,?,?,?,1,?,?) ON CONFLICT(publication_id) DO UPDATE SET
    started_at=CASE WHEN in_progress=1 THEN started_at ELSE excluded.started_at END,
    next_scan_at=CASE WHEN in_progress=1 THEN next_scan_at ELSE excluded.next_scan_at END,
    cursor=CASE WHEN in_progress=1 THEN cursor ELSE NULL END,
    pages_read=CASE WHEN in_progress=1 THEN pages_read ELSE 0 END,
    accounts_read=CASE WHEN in_progress=1 THEN accounts_read ELSE 0 END,
    errors=CASE WHEN in_progress=1 THEN errors ELSE 0 END,
    last_failure=NULL,in_progress=1,lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at
    WHERE (lease_expires_at IS NULL OR lease_expires_at<=?) AND next_attempt_at<=?
      AND (in_progress=1 OR next_scan_at<=?)`,
    )
    .bind(
      publicationId,
      stamp,
      nextScan,
      stamp,
      token,
      new Date(now.getTime() + 30_000).toISOString(),
      stamp,
      stamp,
      stamp,
    )
    .run();
  if (!result.meta.changes) {
    const row = await db
      .prepare(
        'SELECT in_progress,next_scan_at,next_attempt_at FROM beehiiv_poll_checkpoints WHERE publication_id=?',
      )
      .bind(publicationId)
      .first<{ in_progress: number; next_scan_at: string; next_attempt_at: string }>();
    return row &&
      (row.next_attempt_at > stamp || (row.in_progress === 0 && row.next_scan_at > stamp))
      ? 'idle'
      : 'busy';
  }
  const row = await db
    .prepare(
      'SELECT started_at,cursor FROM beehiiv_poll_checkpoints WHERE publication_id=? AND lease_token=?',
    )
    .bind(publicationId, token)
    .first<{ started_at: string; cursor: string | null }>();
  return row ? { publicationId, token, startedAt: row.started_at, cursor: row.cursor } : 'busy';
}

export async function releaseBeehiivPoll(db: Db, scan: BeehiivPollLease): Promise<void> {
  await db
    .prepare(
      'UPDATE beehiiv_poll_checkpoints SET lease_token=NULL,lease_expires_at=NULL WHERE publication_id=? AND lease_token=?',
    )
    .bind(scan.publicationId, scan.token)
    .run();
}

export async function failBeehiivPoll(
  db: Db,
  scan: BeehiivPollLease,
  input: { now: Date; kind: BeehiivPollFailure; retryAfterMs?: number | null },
): Promise<boolean> {
  if (
    !Number.isFinite(input.now.getTime()) ||
    !['provider_error', 'invalid_response', 'transport'].includes(input.kind) ||
    (input.retryAfterMs != null && (!Number.isFinite(input.retryAfterMs) || input.retryAfterMs < 0))
  )
    throw new Error('Invalid Beehiiv poll retry');
  const delay = Math.max(1000, Math.min(86_400_000, input.retryAfterMs ?? 60_000));
  const result = await db
    .prepare(
      `UPDATE beehiiv_poll_checkpoints SET errors=errors+1,last_failure=?,next_attempt_at=? WHERE publication_id=? AND ${CURRENT}`,
    )
    .bind(
      input.kind,
      new Date(input.now.getTime() + delay).toISOString(),
      scan.publicationId,
      ...values(scan, input.now),
    )
    .run();
  return result.meta.changes === 1;
}

async function rejectCursorCycle(
  db: Db,
  scan: BeehiivPollLease,
  next: string | null,
): Promise<void> {
  if (!next) return;
  const seen = await db
    .prepare(
      'SELECT 1 FROM beehiiv_poll_cursors WHERE publication_id=? AND started_at=? AND cursor=?',
    )
    .bind(scan.publicationId, scan.startedAt, next)
    .first();
  if (next === scan.cursor || seen)
    throw new InvalidBeehiivPollPage('Beehiiv repeated a poll cursor');
}

function validatePage(rows: BeehiivPollObservation[], next: string | null, now: Date): void {
  const statuses = [
    'active',
    'inactive',
    'pending',
    'validating',
    'invalid',
    'needs_attention',
    'paused',
  ];
  if (rows.length > 100 || (next !== null && (next.length === 0 || next.length > 4096)))
    throw new InvalidBeehiivPollPage('Invalid Beehiiv page');
  const ids = new Set<string>();
  for (const row of rows) {
    if (
      !/^sub_[A-Za-z0-9_-]{1,124}$/.test(row.id) ||
      ids.has(row.id) ||
      !statuses.includes(row.status) ||
      !Number.isSafeInteger(row.created) ||
      row.created < 0 ||
      row.created > Math.floor(now.getTime() / 1000)
    )
      throw new InvalidBeehiivPollPage('Invalid Beehiiv observation');
    ids.add(row.id);
  }
}

/** Atomically retain one page and its next cursor; absent rows imply no withdrawal. */
export async function saveBeehiivPollPage(
  db: Db,
  scan: BeehiivPollLease,
  input: { rows: BeehiivPollObservation[]; nextCursor: string | null; now: Date },
): Promise<boolean> {
  const { rows, nextCursor, now } = input;
  validatePage(rows, nextCursor, now);
  await rejectCursorCycle(db, scan, nextCursor);
  const observations = JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: new Date(row.created * 1000).toISOString(),
    })),
  );
  const stamp = now.toISOString();
  await db.batch([
    db
      .prepare(
        `DELETE FROM beehiiv_poll_cursors WHERE publication_id=? AND started_at<>? AND ${CURRENT}`,
      )
      .bind(scan.publicationId, scan.startedAt, ...values(scan, now)),
    db
      .prepare(
        `INSERT INTO beehiiv_poll_cursors(publication_id,started_at,cursor) SELECT ?,?,? WHERE ? IS NOT NULL AND ${CURRENT}`,
      )
      .bind(scan.publicationId, scan.startedAt, nextCursor, nextCursor, ...values(scan, now)),
    db
      .prepare(
        `INSERT INTO beehiiv_subscription_observations(publication_id,subscription_id,status,subscription_created_at,observed_at,last_scan_started_at)
      SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.status'),json_extract(value,'$.createdAt'),?,? FROM json_each(?) WHERE ${CURRENT}
      ON CONFLICT(publication_id,subscription_id) DO UPDATE SET status=excluded.status,subscription_created_at=excluded.subscription_created_at,observed_at=excluded.observed_at,last_scan_started_at=excluded.last_scan_started_at
      WHERE excluded.observed_at>=beehiiv_subscription_observations.observed_at`,
      )
      .bind(scan.publicationId, stamp, scan.startedAt, observations, ...values(scan, now)),
    db
      .prepare(
        `UPDATE beehiiv_poll_checkpoints SET cursor=?,in_progress=?,pages_read=pages_read+1,accounts_read=accounts_read+?,last_failure=NULL,next_attempt_at=?,last_completed_at=CASE WHEN ? IS NULL THEN ? ELSE last_completed_at END,last_saved_token=? WHERE publication_id=? AND ${CURRENT}`,
      )
      .bind(
        nextCursor,
        Number(nextCursor !== null),
        rows.length,
        stamp,
        nextCursor,
        stamp,
        scan.token,
        scan.publicationId,
        ...values(scan, now),
      ),
  ]);
  return Boolean(
    await db
      .prepare(
        'SELECT 1 FROM beehiiv_poll_checkpoints WHERE publication_id=? AND last_saved_token=?',
      )
      .bind(scan.publicationId, scan.token)
      .first(),
  );
}
