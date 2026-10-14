import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  claimNewsletterJob,
  loadNewsletterPlan,
  releaseNewsletterLease,
} from '@lasvegasfortransit/platform-storage/newsletter-sync-store';
import { newsletterPause } from '@lasvegasfortransit/platform-storage/newsletter-work';
import { BeehiivSubscriptions } from './beehiiv-subscriptions';
import type { BeehiivConfig } from './beehiiv';
import { NewsletterIntentCipher } from './newsletter-intent-cipher';
import { BeehiivReconciliation, type BeehiivSyncResult } from './beehiiv-sync-context';
import { newsletterTargets, reconcileNewsletterTarget } from './beehiiv-sync-target';
export type { BeehiivSyncResult } from './beehiiv-sync-context';

export interface BeehiivSyncOptions {
  configuration: BeehiivConfig;
  intentKey: string;
  fetcher?: typeof fetch;
  now?: () => Date;
  targetLimit?: number;
}
function targetLimit(value: number | undefined): number {
  const limit = value ?? 1;
  if (!Number.isInteger(limit) || limit < 1 || limit > 25)
    throw new Error('Invalid newsletter target limit');
  return limit;
}

/** A bounded account pass, with every write fenced by current consent and ownership. */
export async function reconcileBeehiivPerson(
  db: Db,
  personId: string,
  options: BeehiivSyncOptions,
): Promise<BeehiivSyncResult> {
  const now = options.now ?? (() => new Date()),
    limit = targetLimit(options.targetLimit);
  const cipher = new NewsletterIntentCipher(options.intentKey);
  const client = new BeehiivSubscriptions(options.configuration, {
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    now: () => now().getTime(),
  });
  if (await newsletterPause(db, options.configuration.publicationId, now()))
    return { kind: 'retry' };
  const lease = await claimNewsletterJob(db, personId, options.configuration.publicationId, now());
  if (!lease) return { kind: 'busy' };
  let context: BeehiivReconciliation | undefined;
  try {
    const plan = await loadNewsletterPlan(db, personId);
    if (!plan) return { kind: 'stale' };
    context = new BeehiivReconciliation({ db, lease, plan, client, cipher, now });
    if (plan.desired === 'unknown')
      return await context.outcome('needs_review', 'consent_evidence_needed');
    for (let index = 0; index < limit; index++) {
      if (!(await context.current())) return context.stale();
      const target = (await newsletterTargets(context))[0];
      if (!target) return await context.outcome('confirmed');
      const result = await reconcileNewsletterTarget(context, target);
      if (result) return result;
    }
    return await context.outcome(
      (await newsletterTargets(context)).length ? 'progress' : 'confirmed',
    );
  } finally {
    if (!context?.released) await releaseNewsletterLease(db, lease);
  }
}
