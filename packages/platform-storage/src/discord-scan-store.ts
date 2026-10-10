import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db, SqlValue } from './db';

export interface DiscordScanLease {
  guildId: string;
  token: string;
  startedAt: string;
  cursor: string | null;
}
export const SCAN_CURRENT = `EXISTS(SELECT 1 FROM provider_scan_checkpoints
  WHERE provider='discord' AND context_id=? AND lease_token=? AND lease_expires_at>?
  AND in_progress=1 AND cursor IS ? AND started_at=?)`;
export function scanValues(scan: DiscordScanLease, now: Date): SqlValue[] {
  return [scan.guildId, scan.token, now.toISOString(), scan.cursor, scan.startedAt];
}
export async function claimDiscordScan(
  db: Db,
  guildId: string,
  now: Date,
): Promise<DiscordScanLease | 'idle' | 'busy'> {
  const token = randomToken(),
    stamp = now.toISOString();
  const nextHour = new Date(
    Math.floor(now.getTime() / 3_600_000) * 3_600_000 + 3_600_000,
  ).toISOString();
  const result = await db
    .prepare(
      `INSERT INTO provider_scan_checkpoints(provider,context_id,started_at,next_scan_at,in_progress,lease_token,lease_expires_at)
    VALUES('discord',?,?,?,1,?,?) ON CONFLICT(provider,context_id) DO UPDATE SET
      started_at=CASE WHEN in_progress=1 THEN started_at ELSE excluded.started_at END,
      next_scan_at=CASE WHEN in_progress=1 THEN next_scan_at ELSE excluded.next_scan_at END,
      cursor=CASE WHEN in_progress=1 THEN cursor ELSE NULL END,in_progress=1,
      lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at
    WHERE (lease_expires_at IS NULL OR lease_expires_at<=?) AND (in_progress=1 OR next_scan_at<=?)`,
    )
    .bind(
      guildId,
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
        "SELECT in_progress,next_scan_at FROM provider_scan_checkpoints WHERE provider='discord' AND context_id=?",
      )
      .bind(guildId)
      .first<{ in_progress: number; next_scan_at: string }>();
    return row?.in_progress === 0 && row.next_scan_at > stamp ? 'idle' : 'busy';
  }
  const row = await db
    .prepare(
      "SELECT started_at,cursor FROM provider_scan_checkpoints WHERE provider='discord' AND context_id=? AND lease_token=?",
    )
    .bind(guildId, token)
    .first<{ started_at: string; cursor: string | null }>();
  return row ? { guildId, token, startedAt: row.started_at, cursor: row.cursor } : 'busy';
}
export async function releaseDiscordScan(db: Db, scan: DiscordScanLease): Promise<void> {
  await db
    .prepare(
      "UPDATE provider_scan_checkpoints SET lease_token=NULL,lease_expires_at=NULL WHERE provider='discord' AND context_id=? AND lease_token=?",
    )
    .bind(scan.guildId, scan.token)
    .run();
}
