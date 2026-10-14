import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import {
  pendingNewsletterSources,
  reviewNewsletterSource,
  type PendingNewsletterSource,
} from '@lasvegasfortransit/platform-storage/newsletter-source-queue';
import { newsletterEmailKey } from '@lasvegasfortransit/platform-storage/newsletter-work';
import { NewsletterEventCipher } from './newsletter-event-cipher';

export interface NewsletterProcessingOptions {
  publicationId: string;
  intentKey: string;
  now: Date;
  limit?: number;
}

async function processOne(
  db: Db,
  event: PendingNewsletterSource,
  cipher: NewsletterEventCipher,
  now: Date,
): Promise<'applied' | 'ignored' | 'needs_review' | 'stale'> {
  let email: string;
  try {
    if (!event.encryptedEmail) throw new Error('Newsletter address unavailable');
    email = await cipher.decrypt(event.encryptedEmail, event);
  } catch {
    return (await reviewNewsletterSource(db, event, 'address_unreadable', now))
      ? 'needs_review'
      : 'stale';
  }
  if ((await newsletterEmailKey(email)) !== event.emailKey)
    return (await reviewNewsletterSource(db, event, 'address_conflict', now))
      ? 'needs_review'
      : 'stale';
  // Storage failures propagate for retry; they must never become address-review decisions.
  const result = await new PersonService(db).applyNewsletterSourceEvent({
    publicationId: event.publicationId,
    eventId: event.id,
    email,
    now,
  });
  return result.kind === 'already_processed' ? 'stale' : result.kind;
}

/** Apply a bounded ready batch; log only aggregate outcomes, never decrypted addresses. */
export async function processNewsletterSourceEvents(db: Db, options: NewsletterProcessingOptions) {
  if (
    !/^pub_[A-Za-z0-9_-]{1,124}$/.test(options.publicationId) ||
    !Number.isFinite(options.now.getTime())
  )
    throw new Error('Invalid newsletter processing configuration');
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(3, Math.floor(options.limit ?? 3)))
    : 3;
  const cipher = new NewsletterEventCipher(options.intentKey);
  const events = await pendingNewsletterSources(db, options.publicationId, options.now, limit);
  const counts = { processed: 0, applied: 0, ignored: 0, review: 0, stale: 0 };
  for (const event of events) {
    const outcome = await processOne(db, event, cipher, options.now);
    if (outcome === 'needs_review') counts.review++;
    else counts[outcome]++;
    if (outcome !== 'stale') counts.processed++;
  }
  return {
    kind: events.length ? ('progress' as const) : ('idle' as const),
    ...counts,
    more: events.length === limit,
  };
}
