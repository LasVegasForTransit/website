import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { discordPause, deferDiscord } from '@lasvegasfortransit/platform-storage/provider-backoff';
import { discordId, DiscordApiFailure, type DiscordRateLimit } from './discord-types';
/** Pause the application's runner conservatively for either a route or global 429. */
export function discordRateLimit(
  db: Db,
  applicationId: string,
  now: () => Date = () => new Date(),
): DiscordRateLimit {
  if (!discordId(applicationId)) throw new DiscordApiFailure('not_configured');
  return {
    current: async () => await discordPause(db, applicationId, now()),
    defer: async (pause) => await deferDiscord(db, applicationId, pause, now()),
  };
}
