import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { pendingDiscordOperations } from '@lasvegasfortransit/platform-storage/discord-pending';
import { DiscordAccess } from './discord-access';
import { DiscordApiFailure, type DiscordConfiguration } from './discord-types';
import { discordRateLimit } from './discord-rate-limit';
import { syncDiscordOperation } from './discord-sync';
export interface DiscordRunnerOptions {
  configuration: DiscordConfiguration;
  applicationId: string;
  memberRoleId: string;
  limit?: number;
  now?: () => Date;
  fetch?: typeof fetch;
}
export interface DiscordRunCounts {
  selected: number;
  confirmed: number;
  retry: number;
  busy: number;
  notReady: number;
  stale: number;
  paused: boolean;
}
/** Bounded scheduled work. A Discord receipt never completes shared Google/mail work. */
export async function reconcileDiscordPending(
  db: Db,
  options: DiscordRunnerOptions,
): Promise<DiscordRunCounts> {
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new DiscordApiFailure('not_configured');
  const now = options.now ?? (() => new Date());
  const started = now();
  const rateLimit = discordRateLimit(db, options.applicationId, now);
  const counts = {
    selected: 0,
    confirmed: 0,
    retry: 0,
    busy: 0,
    notReady: 0,
    stale: 0,
    paused: false,
  };
  const client = new DiscordAccess(options.configuration, {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    rateLimit,
    now: () => now().getTime(),
  });
  if (await rateLimit.current()) return { ...counts, paused: true };
  const operations = await pendingDiscordOperations(db, started, limit);
  for (const operationId of operations) {
    if (now().getTime() - started.getTime() >= 50_000) break;
    if (await rateLimit.current()) {
      counts.paused = true;
      break;
    }
    counts.selected += 1;
    const result = await syncDiscordOperation(db, operationId, {
      client,
      memberRoleId: options.memberRoleId,
      now,
    });
    if (result.kind === 'not_ready') counts.notReady += 1;
    else counts[result.kind] += 1;
  }
  counts.paused = Boolean(await rateLimit.current());
  return counts;
}
