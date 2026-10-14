import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  loadNewsletterPlan,
  newsletterPlanIsCurrent,
  saveNewsletterOutcome,
  type NewsletterLease,
  type NewsletterFailure,
} from '@lasvegasfortransit/platform-storage/newsletter-sync-store';
import type { NewsletterPlan } from '@lasvegasfortransit/platform-storage/newsletter-plan';
import {
  newsletterEmailKey,
  reserveNewsletterAccount,
  renewNewsletterLease,
  prepareNewsletterIntent,
  markNewsletterWrite,
  rememberNewsletterIntentId,
  attachNewsletterSubscription,
  newsletterAccountConflict,
  pauseNewsletter,
  type NewsletterWriteIntent,
} from '@lasvegasfortransit/platform-storage/newsletter-work';
import type { BeehiivSubscriptions, BeehiivSubscriptionFailure } from './beehiiv-subscriptions';
import type { BeehiivSubscription } from './beehiiv';
import type { NewsletterIntentCipher } from './newsletter-intent-cipher';

export interface BeehiivSyncResult {
  kind: 'confirmed' | 'progress' | 'retry' | 'needs_review' | 'stale' | 'busy';
}
interface ContextInput {
  db: Db;
  lease: NewsletterLease;
  plan: NewsletterPlan;
  client: BeehiivSubscriptions;
  cipher: NewsletterIntentCipher;
  now: () => Date;
}
export class BeehiivReconciliation {
  readonly db: Db;
  readonly lease: NewsletterLease;
  readonly client: BeehiivSubscriptions;
  readonly cipher: NewsletterIntentCipher;
  readonly now: () => Date;
  plan: NewsletterPlan;
  constructor(input: ContextInput) {
    this.db = input.db;
    this.lease = input.lease;
    this.plan = input.plan;
    this.client = input.client;
    this.cipher = input.cipher;
    this.now = input.now;
  }
  stale(): BeehiivSyncResult {
    return { kind: 'stale' };
  }
  async current(): Promise<boolean> {
    return (
      (await newsletterPlanIsCurrent(this.db, this.plan)) &&
      (await renewNewsletterLease(this.db, this.lease, this.now()))
    );
  }
  async outcome(
    kind: 'confirmed' | 'progress' | 'retry' | 'needs_review',
    failure: NewsletterFailure = 'unknown',
    retryAfterMs?: number,
  ): Promise<BeehiivSyncResult> {
    const result =
      kind === 'confirmed' || kind === 'progress'
        ? { kind, now: this.now() }
        : { kind, failure, ...(retryAfterMs ? { retryAfterMs } : {}), now: this.now() };
    const saved = await saveNewsletterOutcome(this.db, this.plan, this.lease, result);
    return { kind: saved ? kind : 'stale' };
  }
  async failed(failure: BeehiivSubscriptionFailure): Promise<BeehiivSyncResult> {
    if (failure.status === 429) {
      await pauseNewsletter(
        this.db,
        this.lease.publicationId,
        failure.retryAfterMs ?? 60_000,
        this.now(),
      );
      return await this.outcome('retry', 'rate_limited', failure.retryAfterMs ?? 60_000);
    }
    if (failure.status === 401 || failure.status === 403)
      return await this.outcome('needs_review', 'permission_denied');
    return await this.outcome(
      'retry',
      failure.kind === 'invalid_response' ? 'unknown' : 'provider_unavailable',
      failure.retryAfterMs ?? 60_000,
    );
  }
  async remember(
    subscription: BeehiivSubscription,
    intent?: NewsletterWriteIntent,
  ): Promise<boolean> {
    if (!(await reserveNewsletterAccount(this.db, this.lease, `id:${subscription.id}`, this.now())))
      return false;
    return (
      !intent ||
      (await rememberNewsletterIntentId(this.db, this.lease, {
        intent,
        id: subscription.id,
        now: this.now(),
      }))
    );
  }
  async conflict(subscription: BeehiivSubscription): Promise<boolean> {
    return await newsletterAccountConflict(
      this.db,
      this.plan.personId,
      subscription.id,
      subscription.email,
    );
  }
  async prepare(address: string): Promise<NewsletterWriteIntent | null> {
    const id = ulid(),
      personId = this.plan.personId,
      publicationId = this.lease.publicationId;
    const encryptedEmail = await this.cipher.encrypt(address, { id, personId, publicationId });
    return await prepareNewsletterIntent(this.db, this.plan, this.lease, {
      id,
      accountKey: await newsletterEmailKey(address),
      encryptedEmail,
      now: this.now(),
    });
  }
  async authorizeWrite(intent: NewsletterWriteIntent): Promise<boolean> {
    const marked = await markNewsletterWrite(this.db, this.plan, this.lease, {
      intent,
      now: this.now(),
    });
    return marked && (await this.current());
  }
  async attach(subscription: BeehiivSubscription): Promise<BeehiivSyncResult | null> {
    const attached = await attachNewsletterSubscription(this.db, this.plan, this.lease, {
      id: subscription.id,
      email: subscription.email,
      now: this.now(),
    });
    if (!attached) return await this.outcome('needs_review', 'identity_conflict');
    const plan = await loadNewsletterPlan(this.db, this.plan.personId);
    if (
      plan?.desired !== 'active' ||
      plan.email?.toLowerCase() !== subscription.email.toLowerCase()
    )
      return this.stale();
    this.plan = plan;
    return (await this.current()) ? null : this.stale();
  }
}
