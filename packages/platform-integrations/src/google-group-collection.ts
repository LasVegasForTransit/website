import type { AccessFailure } from '@lasvegasfortransit/platform-core/access';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  googleGroupRegistered,
  saveGoogleGroupSnapshot,
  recordGoogleGroupCheckFailure,
} from '@lasvegasfortransit/platform-storage/google-group-snapshots';
import { GoogleGroupsFailure, type GoogleGroups } from './google-groups';
import { readGoogleGroupInventory } from './google-group-inventory';

interface Options {
  groupEmail: string;
  consoleGroupEmail: string | null;
  isCurrent(): Promise<boolean>;
  now?: () => Date;
}
export type GoogleGroupCollectionResult =
  | { kind: 'saved'; userCount: number | null }
  | { kind: 'stale' }
  | { kind: 'failed'; failure: AccessFailure };

function failureKind(error: unknown): AccessFailure {
  if (
    error instanceof GoogleGroupsFailure &&
    ['provider_unavailable', 'rate_limited', 'permission_denied'].includes(error.kind)
  )
    return error.kind as AccessFailure;
  return 'unknown';
}

/** Provider work publishes a whole check; staff rendering reads only the saved result. */
export async function collectGoogleGroupSnapshot(
  db: Db,
  client: GoogleGroups,
  options: Options,
): Promise<GoogleGroupCollectionResult> {
  const request = { ...options };
  const now = request.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const isCurrent = async () => {
    const authorized: unknown = await request.isCurrent();
    return (
      authorized === true &&
      (await googleGroupRegistered(db, request.groupEmail, request.consoleGroupEmail))
    );
  };
  try {
    if (!(await isCurrent())) return { kind: 'stale' };
    const snapshot = await readGoogleGroupInventory(
      client,
      { groupEmail: request.groupEmail, isCurrent },
      { now: () => now().getTime() },
    );
    const saved = await saveGoogleGroupSnapshot(db, snapshot, {
      consoleGroupEmail: request.consoleGroupEmail,
      now: now(),
      isCurrent,
    });
    return saved ? { kind: 'saved', userCount: snapshot.userCount } : { kind: 'stale' };
  } catch (error) {
    if (error instanceof GoogleGroupsFailure && error.kind === 'stale_operation')
      return { kind: 'stale' };
    const failure = failureKind(error);
    const recorded = await recordGoogleGroupCheckFailure(
      db,
      {
        customerId: client.configuration.customerId,
        groupEmail: request.groupEmail,
        failure,
        startedAt,
      },
      { consoleGroupEmail: request.consoleGroupEmail, now: now() },
    );
    return recorded ? { kind: 'failed', failure } : { kind: 'stale' };
  }
}
