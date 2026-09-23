// Abuse limits and one-time form tokens.

import { nowIso } from '../core/ids';
import type { Db } from './db';

/**
 * Count one attempt for `bucket` in the current hour and report whether the
 * caller is still within `limit`. The bucket is a hash, never a raw address.
 */
export async function withinHourlyLimit(
  db: Db,
  bucket: string,
  limit: number,
  now: Date = new Date(),
): Promise<boolean> {
  const window = new Date(now);
  window.setUTCMinutes(0, 0, 0);
  const windowStart = window.toISOString();
  const stamp = nowIso();
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, count, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at
       RETURNING count`,
    )
    .bind(bucket, windowStart, stamp, stamp)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= limit;
}

/** The person a form token already joined, if this token was used before. */
export async function personForFormToken(db: Db, formToken: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT person_id AS personId FROM form_submissions WHERE form_token = ?')
    .bind(formToken)
    .first<{ personId: string }>();
  return row?.personId ?? null;
}

export async function recordFormToken(db: Db, formToken: string, personId: string): Promise<void> {
  const stamp = nowIso();
  await db
    .prepare(
      `INSERT INTO form_submissions (form_token, person_id, created_at, updated_at)
       VALUES (?, ?, ?, ?) ON CONFLICT (form_token) DO NOTHING`,
    )
    .bind(formToken, personId, stamp, stamp)
    .run();
}

/** The region a ZIP code sets: one region holding at least 90% of its people. */
export async function regionForZip(db: Db, zip: string): Promise<string | null> {
  const row = await db
    .prepare(
      'SELECT region_id AS regionId FROM zip_regions WHERE zip = ? AND population_share >= 0.9 LIMIT 1',
    )
    .bind(zip)
    .first<{ regionId: string }>();
  return row?.regionId ?? null;
}
