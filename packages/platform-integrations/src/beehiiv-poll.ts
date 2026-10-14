import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  claimBeehiivPoll,
  failBeehiivPoll,
  releaseBeehiivPoll,
  saveBeehiivPollPage,
  InvalidBeehiivPollPage,
} from '@lasvegasfortransit/platform-storage/beehiiv-poll-store';
import { listSubscriptions, type BeehiivConfig } from './beehiiv';

export interface BeehiivPollResult {
  kind: 'scanned' | 'idle' | 'busy' | 'stale' | 'retry';
  records: number;
  complete: boolean;
}

/** Read one cursor page per invocation, without inferring consent from delivery status. */
export async function pollBeehiivRoster(
  db: Db,
  configuration: BeehiivConfig,
  options: { now?: () => Date; fetcher?: typeof fetch } = {},
): Promise<BeehiivPollResult> {
  const now = options.now ?? (() => new Date());
  const scan = await claimBeehiivPoll(db, configuration.publicationId, now());
  if (typeof scan === 'string') return { kind: scan, records: 0, complete: false };
  try {
    const page = await listSubscriptions(
      configuration,
      { ...(scan.cursor ? { cursor: scan.cursor } : {}), limit: 100, now: () => now().getTime() },
      options.fetcher,
    );
    if (!page.ok) {
      const saved = await failBeehiivPoll(db, scan, {
        now: now(),
        kind: page.kind,
        retryAfterMs: page.retryAfterMs,
      });
      return { kind: saved ? 'retry' : 'stale', records: 0, complete: false };
    }
    const saved = await saveBeehiivPollPage(db, scan, {
      rows: page.subscriptions,
      nextCursor: page.nextCursor,
      now: now(),
    });
    return saved
      ? { kind: 'scanned', records: page.subscriptions.length, complete: !page.hasMore }
      : { kind: 'stale', records: 0, complete: false };
  } catch (error) {
    if (!(error instanceof InvalidBeehiivPollPage)) throw error;
    const saved = await failBeehiivPoll(db, scan, { now: now(), kind: 'invalid_response' });
    return { kind: saved ? 'retry' : 'stale', records: 0, complete: false };
  } finally {
    await releaseBeehiivPoll(db, scan);
  }
}
