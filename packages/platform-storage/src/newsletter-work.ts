import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db, SqlValue } from './db';
import { newsletterPlanGuard, type NewsletterPlan } from './newsletter-plan';
import {
  newsletterLeaseGuard,
  newsletterLeaseIsCurrent,
  type NewsletterLease,
} from './newsletter-sync-store';

export interface NewsletterWriteIntent {
  id: string;
  publicationId: string;
  personId: string;
  accountKey: string;
  encryptedEmail: string | null;
  subscriptionId: string | null;
  writeStartedAt: string | null;
}
const INTENT_COLUMNS =
  'id,publication_id AS publicationId,person_id AS personId,account_key AS accountKey,encrypted_email AS encryptedEmail,subscription_id AS subscriptionId,write_started_at AS writeStartedAt';

function guard(
  plan: NewsletterPlan,
  lease: NewsletterLease,
  now: Date,
): { sql: string; values: SqlValue[] } {
  const current = newsletterPlanGuard(plan, lease.publicationId),
    held = newsletterLeaseGuard(lease, now);
  return { sql: `${current.sql} AND ${held.sql}`, values: [...current.values, ...held.values] };
}
export async function newsletterEmailKey(email: string): Promise<string> {
  return `email:${await digestToken(email.trim().toLowerCase())}`;
}
export async function newsletterIntents(
  db: Db,
  plan: NewsletterPlan,
  publicationId: string,
): Promise<NewsletterWriteIntent[]> {
  const key = plan.email ? await newsletterEmailKey(plan.email) : '';
  return (
    await db
      .prepare(
        `SELECT ${INTENT_COLUMNS} FROM newsletter_write_intents WHERE publication_id=? AND (person_id=? OR account_key=?) ORDER BY created_at,id`,
      )
      .bind(publicationId, plan.personId, key)
      .all<NewsletterWriteIntent>()
  ).results;
}
export async function reserveNewsletterAccount(
  db: Db,
  lease: NewsletterLease,
  key: string,
  now: Date,
): Promise<boolean> {
  if (lease.accountKeys.includes(key)) return await newsletterLeaseIsCurrent(db, lease, now);
  const held = newsletterLeaseGuard(lease, now);
  await db
    .prepare(
      `INSERT INTO newsletter_account_leases(publication_id,account_key,token,expires_at) SELECT ?,?,?,? WHERE ${held.sql} ON CONFLICT(publication_id,account_key) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE newsletter_account_leases.expires_at<=?`,
    )
    .bind(
      lease.publicationId,
      key,
      lease.token,
      new Date(now.getTime() + 30_000).toISOString(),
      ...held.values,
      now.toISOString(),
    )
    .run();
  lease.accountKeys.push(key);
  lease.accountKeys.sort();
  return await newsletterLeaseIsCurrent(db, lease, now);
}
export async function renewNewsletterLease(
  db: Db,
  lease: NewsletterLease,
  now: Date,
): Promise<boolean> {
  const held = newsletterLeaseGuard(lease, now),
    expires = new Date(now.getTime() + 30_000).toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE newsletter_sync_jobs SET lease_expires_at=? WHERE person_id=? AND ${held.sql}`,
      )
      .bind(expires, lease.personId, ...held.values),
    db
      .prepare(
        `UPDATE newsletter_account_leases SET expires_at=? WHERE publication_id=? AND token=? AND ${held.sql}`,
      )
      .bind(expires, lease.publicationId, lease.token, ...held.values),
  ]);
  return await newsletterLeaseIsCurrent(db, lease, now);
}
export async function prepareNewsletterIntent(
  db: Db,
  plan: NewsletterPlan,
  lease: NewsletterLease,
  input: { id: string; accountKey: string; encryptedEmail: string; now: Date },
): Promise<NewsletterWriteIntent | null> {
  const current = guard(plan, lease, input.now);
  await db
    .prepare(
      `INSERT INTO newsletter_write_intents(id,publication_id,person_id,account_key,encrypted_email,created_at) SELECT ?,?,?,?,?,? WHERE ${current.sql} ON CONFLICT(publication_id,account_key) DO NOTHING`,
    )
    .bind(
      input.id,
      lease.publicationId,
      plan.personId,
      input.accountKey,
      input.encryptedEmail,
      input.now.toISOString(),
      ...current.values,
    )
    .run();
  return await db
    .prepare(
      `SELECT ${INTENT_COLUMNS} FROM newsletter_write_intents WHERE publication_id=? AND account_key=?`,
    )
    .bind(lease.publicationId, input.accountKey)
    .first<NewsletterWriteIntent>();
}
export async function markNewsletterWrite(
  db: Db,
  plan: NewsletterPlan,
  lease: NewsletterLease,
  input: { intent: NewsletterWriteIntent; now: Date },
): Promise<boolean> {
  const { intent, now } = input;
  if (!lease.accountKeys.includes(intent.accountKey)) return false;
  const current = guard(plan, lease, now);
  return (
    (
      await db
        .prepare(
          `UPDATE newsletter_write_intents SET write_started_at=coalesce(write_started_at,?) WHERE id=? AND publication_id=? AND ${current.sql}`,
        )
        .bind(now.toISOString(), intent.id, lease.publicationId, ...current.values)
        .run()
    ).meta.changes === 1
  );
}
/** Keep a returned stable ID even if withdrawal superseded the original grant. */
export async function rememberNewsletterIntentId(
  db: Db,
  lease: NewsletterLease,
  input: { intent: NewsletterWriteIntent; id: string; now: Date },
): Promise<boolean> {
  const { intent, id, now } = input;
  if (!lease.accountKeys.includes(intent.accountKey) || !/^sub_[A-Za-z0-9_-]{1,124}$/.test(id))
    return false;
  const held = newsletterLeaseGuard(lease, now);
  return (
    (
      await db
        .prepare(
          `UPDATE newsletter_write_intents SET subscription_id=?,encrypted_email=NULL WHERE id=? AND publication_id=? AND (subscription_id IS NULL OR subscription_id=?) AND ${held.sql}`,
        )
        .bind(id, intent.id, lease.publicationId, id, ...held.values)
        .run()
    ).meta.changes === 1
  );
}
export async function finishNewsletterIntent(
  db: Db,
  plan: NewsletterPlan,
  lease: NewsletterLease,
  input: { intent: NewsletterWriteIntent; now: Date },
): Promise<boolean> {
  const { intent, now } = input;
  if (!lease.accountKeys.includes(intent.accountKey)) return false;
  const current = guard(plan, lease, now);
  return (
    (
      await db
        .prepare(
          `DELETE FROM newsletter_write_intents WHERE id=? AND publication_id=? AND ${current.sql}`,
        )
        .bind(intent.id, lease.publicationId, ...current.values)
        .run()
    ).meta.changes === 1
  );
}
export async function newsletterAccountConflict(
  db: Db,
  personId: string,
  id: string,
  email: string,
): Promise<boolean> {
  return Boolean(
    await db
      .prepare(
        `SELECT 1 WHERE EXISTS(SELECT 1 FROM identities i JOIN person_keys k ON k.id=i.person_id WHERE i.platform='beehiiv' AND i.external_id=? AND i.person_id<>? AND k.erased_at IS NULL) OR EXISTS(SELECT 1 FROM people WHERE lower(email)=? AND id<>? AND deleted_at IS NULL)`,
      )
      .bind(id, personId, email.toLowerCase(), personId)
      .first(),
  );
}
/** Exact provider readback plus fresh canonical consent can adopt an erased owner's account. */
export async function attachNewsletterSubscription(
  db: Db,
  plan: NewsletterPlan,
  lease: NewsletterLease,
  input: { id: string; email: string; now: Date },
): Promise<boolean> {
  const { id, email, now } = input;
  if (
    plan.desired !== 'active' ||
    plan.email?.toLowerCase() !== email.toLowerCase() ||
    !lease.accountKeys.includes(`id:${id}`)
  )
    return false;
  const current = guard(plan, lease, now),
    stamp = now.toISOString();
  await db
    .prepare(
      `INSERT INTO identities(id,person_id,platform,external_id,external_email,linked_at,link_method,created_at,updated_at) SELECT ?,?,'beehiiv',?,?,?,'created_by_platform',?,? WHERE ${current.sql} ON CONFLICT(platform,external_id) DO UPDATE SET person_id=excluded.person_id,external_email=excluded.external_email,updated_at=excluded.updated_at WHERE identities.person_id=excluded.person_id OR (? AND EXISTS(SELECT 1 FROM person_keys WHERE id=identities.person_id AND erased_at IS NOT NULL))`,
    )
    .bind(
      ulid(),
      plan.personId,
      id,
      email,
      stamp,
      stamp,
      stamp,
      ...current.values,
      Number(plan.allowActivation),
    )
    .run();
  return Boolean(
    await db
      .prepare(
        "SELECT 1 FROM identities WHERE platform='beehiiv' AND external_id=? AND person_id=? AND external_email=?",
      )
      .bind(id, plan.personId, email)
      .first(),
  );
}
export async function newsletterConfirmedTargets(
  db: Db,
  plan: NewsletterPlan,
  lease: NewsletterLease,
  now: Date,
): Promise<Set<string>> {
  const hash = await digestToken(plan.snapshot);
  const { results } = await db
    .prepare(
      'SELECT target_key FROM newsletter_target_receipts WHERE publication_id=? AND person_id=? AND generation=? AND revision_hash=? AND observed_at<=?',
    )
    .bind(lease.publicationId, plan.personId, plan.generation, hash, now.toISOString())
    .all<{ target_key: string }>();
  return new Set(results.map((value) => value.target_key));
}
export async function confirmNewsletterTargets(
  db: Db,
  plan: NewsletterPlan,
  lease: NewsletterLease,
  input: { keys: string[]; desired: 'active' | 'inactive'; now: Date },
): Promise<boolean> {
  const { keys, desired, now } = input;
  const current = guard(plan, lease, now),
    hash = await digestToken(plan.snapshot);
  const result = await db
    .prepare(
      `INSERT INTO newsletter_target_receipts(publication_id,person_id,generation,revision_hash,target_key,desired,observed_at) SELECT ?,?,?,?,value,?,? FROM json_each(?) WHERE ${current.sql} ON CONFLICT(publication_id,person_id,generation,target_key) DO UPDATE SET revision_hash=excluded.revision_hash,desired=excluded.desired,observed_at=excluded.observed_at`,
    )
    .bind(
      lease.publicationId,
      plan.personId,
      plan.generation,
      hash,
      desired,
      now.toISOString(),
      JSON.stringify(keys),
      ...current.values,
    )
    .run();
  return result.meta.changes === keys.length;
}
export async function newsletterPause(db: Db, publicationId: string, now: Date): Promise<number> {
  const row = await db
    .prepare(
      'SELECT until_at FROM newsletter_provider_backoffs WHERE publication_id=? AND until_at>?',
    )
    .bind(publicationId, now.toISOString())
    .first<{ until_at: string }>();
  return row ? Date.parse(row.until_at) - now.getTime() : 0;
}
export async function pauseNewsletter(
  db: Db,
  publicationId: string,
  delay: number,
  now: Date,
): Promise<void> {
  const until = new Date(now.getTime() + Math.max(1000, Math.min(86_400_000, delay))).toISOString();
  await db
    .prepare(
      'INSERT INTO newsletter_provider_backoffs(publication_id,until_at) VALUES(?,?) ON CONFLICT(publication_id) DO UPDATE SET until_at=excluded.until_at WHERE excluded.until_at>newsletter_provider_backoffs.until_at',
    )
    .bind(publicationId, until)
    .run();
}
