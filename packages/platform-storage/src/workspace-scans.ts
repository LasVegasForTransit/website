import { randomToken, digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from './db';
export async function claimWorkspaceScan(db: Db, customerId: string, now: Date) {
  const token = randomToken();
  await db
    .prepare(
      'INSERT INTO workspace_directory_scans(customer_id,next_due_at) VALUES(?,?) ON CONFLICT(customer_id) DO NOTHING',
    )
    .bind(customerId, now.toISOString())
    .run();
  const row = await db
    .prepare(
      `UPDATE workspace_directory_scans SET lease_hash=?,lease_until=? WHERE customer_id=? AND next_due_at<=?
    AND (lease_until IS NULL OR lease_until<=?) RETURNING phase,page_token,page_offset`,
    )
    .bind(
      await digestToken(token),
      new Date(now.getTime() + 60000).toISOString(),
      customerId,
      now.toISOString(),
      now.toISOString(),
    )
    .first<{ phase: 'active' | 'deleted'; page_token: string | null; page_offset: number }>();
  return row
    ? { token, phase: row.phase, pageToken: row.page_token, offset: row.page_offset }
    : null;
}
export async function saveWorkspaceScan(
  db: Db,
  customerId: string,
  input: Record<string, unknown>,
  now: Date,
) {
  const checkpoint = parseCheckpoint(input);
  if (!checkpoint) return false;
  return (
    (
      await db
        .prepare(
          `UPDATE workspace_directory_scans SET phase=?,page_token=?,page_offset=?,next_due_at=?,lease_hash=NULL,lease_until=NULL
    WHERE customer_id=? AND lease_hash=? AND lease_until>? AND (?=0 OR phase='deleted') AND (phase='active' OR ?='deleted')`,
        )
        .bind(
          checkpoint.complete ? 'active' : checkpoint.phase,
          checkpoint.complete ? null : checkpoint.pageToken,
          checkpoint.complete ? 0 : checkpoint.offset,
          new Date(now.getTime() + (checkpoint.complete ? 300000 : 0)).toISOString(),
          customerId,
          await digestToken(checkpoint.token),
          now.toISOString(),
          Number(checkpoint.complete),
          checkpoint.phase,
        )
        .run()
    ).meta.changes > 0
  );
}

interface ScanCheckpoint {
  token: string;
  phase: 'active' | 'deleted';
  pageToken: string | null;
  offset: number;
  complete: boolean;
}
function validToken(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{43}$/.test(value);
}
function validCursor(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= 4096);
}
function validOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 500;
}
function parseCheckpoint(input: Record<string, unknown>): ScanCheckpoint | null {
  if (input.phase !== 'active' && input.phase !== 'deleted') return null;
  if (
    !validToken(input.token) ||
    !validCursor(input.pageToken) ||
    !validOffset(input.offset) ||
    typeof input.complete !== 'boolean'
  )
    return null;
  if (
    input.complete &&
    (input.phase !== 'deleted' || input.pageToken !== null || input.offset !== 0)
  )
    return null;
  return {
    token: input.token,
    phase: input.phase,
    pageToken: input.pageToken,
    offset: input.offset,
    complete: input.complete,
  };
}
/** Restart discovery only while this exact customer lease remains current. No account state changes. */
export async function resetWorkspaceScan(
  db: Db,
  customerId: string,
  input: Record<string, unknown>,
  now: Date,
) {
  if (!validToken(input.token)) return false;
  const result = await db
    .prepare(
      `UPDATE workspace_directory_scans SET phase='active',page_token=NULL,page_offset=0,next_due_at=?,lease_hash=NULL,lease_until=NULL
    WHERE customer_id=? AND lease_hash=? AND lease_until>?`,
    )
    .bind(now.toISOString(), customerId, await digestToken(input.token), now.toISOString())
    .run();
  return result.meta.changes > 0;
}
