import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  deferProvider,
  providerPause,
} from '@lasvegasfortransit/platform-storage/provider-backoff';
import { GoogleGroupsFailure, type GoogleGroupsOptions } from './google-groups';

/** Persist a customer-wide pause so a new Worker instance honors Workspace quota responses. */
export function googleRateLimit(
  db: Db,
  customerId: string,
  now: () => Date = () => new Date(),
): NonNullable<GoogleGroupsOptions['rateLimit']> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(customerId) || customerId === 'my_customer')
    throw new GoogleGroupsFailure('not_configured');
  return {
    current: async () =>
      (await providerPause(db, 'google_workspace', customerId, now()))?.retryAfterMs ?? null,
    defer: async (retryAfterMs) =>
      await deferProvider(db, {
        provider: 'google_workspace',
        contextId: customerId,
        pause: { retryAfterMs, global: true },
        now: now(),
      }),
  };
}
