import { isDiscordId } from '@lasvegasfortransit/platform-core/discord-identity';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  claimDiscordScan,
  releaseDiscordScan,
} from '@lasvegasfortransit/platform-storage/discord-scan-store';
import {
  recordDiscordRosterPage,
  recordDiscordRosterScanError,
} from '@lasvegasfortransit/platform-storage/discord-roster';
import type { DiscordAccess, DiscordGuildMember } from './discord-access';

export interface DiscordRosterScanResult {
  kind: 'scanned' | 'idle' | 'busy' | 'stale' | 'retry';
  scanned: number;
  flagged: number;
  complete: boolean;
}

interface Options {
  client: Pick<DiscordAccess, 'listGuildMembers'> & {
    configuration: Pick<DiscordAccess['configuration'], 'guildId'>;
  };
  memberRoleId: string;
  now?: () => Date;
}

/** Read one bounded Discord page per minute, retaining the cursor across retries. */
export async function scanDiscordGuildRoster(
  db: Db,
  options: Options,
): Promise<DiscordRosterScanResult> {
  const now = options.now ?? (() => new Date()),
    started = now(),
    guildId = options.client.configuration.guildId;
  if (
    !isDiscordId(guildId) ||
    !isDiscordId(options.memberRoleId) ||
    !Number.isFinite(started.getTime())
  )
    throw new Error('Invalid Discord roster scan configuration');
  const scan = await claimDiscordScan(db, guildId, started, `guild-roster:${guildId}`);
  if (typeof scan === 'string') return { kind: scan, scanned: 0, flagged: 0, complete: false };
  try {
    const members: DiscordGuildMember[] = await options.client.listGuildMembers(
      scan.cursor ?? undefined,
    );
    const saved = await recordDiscordRosterPage(db, {
      scan,
      members,
      memberRoleId: options.memberRoleId,
      now: now(),
    });
    return saved
      ? { kind: 'scanned', ...saved }
      : { kind: 'stale', scanned: 0, flagged: 0, complete: false };
  } catch {
    const current = await recordDiscordRosterScanError(db, scan, now());
    return current
      ? { kind: 'retry', scanned: 0, flagged: 0, complete: false }
      : { kind: 'stale', scanned: 0, flagged: 0, complete: false };
  } finally {
    await releaseDiscordScan(db, scan);
  }
}
