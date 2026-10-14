import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db } from './db';
import { newsletterPlanGuard, type NewsletterPlan } from './newsletter-plan';
import { newsletterLeaseGuard, type NewsletterLease } from './newsletter-sync-store';

/** Persist possible API causation before the request, including requests whose response is lost. */
export async function recordNewsletterAttempt(
  db: Db,
  plan: NewsletterPlan,
  lease: NewsletterLease,
  input: { accountKey: string; subscriptionId?: string; desired: 'active' | 'inactive'; now: Date },
): Promise<boolean> {
  const key = input.subscriptionId ? `id:${input.subscriptionId}` : input.accountKey;
  if (!lease.accountKeys.includes(key)) return false;
  const current = newsletterPlanGuard(plan),
    held = newsletterLeaseGuard(lease, input.now);
  const saved = await db
    .prepare(
      `INSERT INTO newsletter_write_attempts(id,publication_id,person_id,account_key,subscription_id,desired,started_at)
    SELECT ?,?,?,?,?,?,? WHERE ${current.sql} AND ${held.sql}`,
    )
    .bind(
      ulid(),
      lease.publicationId,
      plan.personId,
      input.accountKey,
      input.subscriptionId ?? null,
      input.desired,
      input.now.toISOString(),
      ...current.values,
      ...held.values,
    )
    .run();
  return saved.meta.changes === 1;
}
