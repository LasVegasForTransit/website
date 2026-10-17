import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from './db';

export const COMMAND_RETRY_MS = 30 * 60_000;
export interface CommandLease {
  contextId: string;
  token: string;
}
/** A command definition is completed once; interrupted attempts also wait before retrying. */
export async function claimDiscordCommand(
  db: Db,
  contextId: string,
  now: Date,
): Promise<CommandLease | null> {
  const token = randomToken();
  const stamp = now.toISOString();
  const result = await db
    .prepare(
      `INSERT INTO provider_scan_checkpoints
    (provider,context_id,started_at,next_scan_at,in_progress,lease_token,lease_expires_at)
    VALUES('discord',?,?,?,1,?,?) ON CONFLICT(provider,context_id) DO UPDATE SET
    started_at=excluded.started_at,next_scan_at=excluded.next_scan_at,in_progress=1,
    lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at
    WHERE last_completed_at IS NULL AND next_scan_at<=?
    AND (lease_expires_at IS NULL OR lease_expires_at<=?)`,
    )
    .bind(
      contextId,
      stamp,
      new Date(now.getTime() + COMMAND_RETRY_MS).toISOString(),
      token,
      new Date(now.getTime() + 30_000).toISOString(),
      stamp,
      stamp,
    )
    .run();
  return result.meta.changes ? { contextId, token } : null;
}
export async function settleDiscordCommand(
  db: Db,
  lease: CommandLease,
  now: Date,
  outcome: { complete: boolean; retryAfterMs?: number },
): Promise<boolean> {
  const { complete, retryAfterMs = COMMAND_RETRY_MS } = outcome;
  const stamp = now.toISOString();
  const result = await db
    .prepare(
      `UPDATE provider_scan_checkpoints SET
    last_completed_at=?,next_scan_at=?,in_progress=0,lease_token=NULL,lease_expires_at=NULL
    WHERE provider='discord' AND context_id=? AND lease_token=? AND lease_expires_at>?`,
    )
    .bind(
      complete ? stamp : null,
      new Date(now.getTime() + Math.max(COMMAND_RETRY_MS, retryAfterMs)).toISOString(),
      lease.contextId,
      lease.token,
      stamp,
    )
    .run();
  return Boolean(result.meta.changes);
}
