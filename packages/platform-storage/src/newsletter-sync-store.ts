import { randomToken, digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db, SqlValue } from './db';
import {
  loadNewsletterPlan,
  newsletterPlanGuard,
  newsletterPlanIsCurrent,
  type NewsletterPlan,
} from './newsletter-plan';
export { loadNewsletterPlan, newsletterPlanIsCurrent } from './newsletter-plan';

export interface NewsletterLease {
  personId: string;
  publicationId: string;
  token: string;
  accountKeys: string[];
}
export type NewsletterFailure =
  | 'provider_unavailable'
  | 'rate_limited'
  | 'permission_denied'
  | 'unknown'
  | 'identity_conflict'
  | 'consent_evidence_needed';
export type NewsletterOutcome =
  | { kind: 'confirmed'; now: Date }
  | { kind: 'progress'; now: Date }
  | {
      kind: 'retry' | 'needs_review';
      failure: NewsletterFailure;
      retryAfterMs?: number;
      now: Date;
    };

async function accountKeys(db: Db, plan: NewsletterPlan, publicationId: string): Promise<string[]> {
  const emails = [plan.email, ...plan.identities.map((identity) => identity.email)].filter(
    (email): email is string => Boolean(email),
  );
  const keys = [
    ...new Set([
      ...plan.identities.map((identity) => `id:${identity.externalId}`),
      ...(await Promise.all(
        emails.map(async (email) => `email:${await digestToken(email.trim().toLowerCase())}`),
      )),
    ]),
  ].sort();
  const { results } = await db
    .prepare(
      'SELECT account_key,subscription_id FROM newsletter_write_intents WHERE publication_id=? AND (person_id=? OR account_key IN (SELECT value FROM json_each(?)))',
    )
    .bind(publicationId, plan.personId, JSON.stringify(keys))
    .all<{ account_key: string; subscription_id: string | null }>();
  return [
    ...new Set([
      ...keys,
      ...results.flatMap((value) => [
        value.account_key,
        ...(value.subscription_id ? [`id:${value.subscription_id}`] : []),
      ]),
    ]),
  ].sort();
}

export async function releaseNewsletterLease(db: Db, lease: NewsletterLease): Promise<void> {
  await db.batch([
    db
      .prepare('DELETE FROM newsletter_account_leases WHERE publication_id=? AND token=?')
      .bind(lease.publicationId, lease.token),
    db
      .prepare(
        'UPDATE newsletter_sync_jobs SET lease_token=NULL,lease_expires_at=NULL WHERE person_id=? AND lease_token=?',
      )
      .bind(lease.personId, lease.token),
  ]);
}

export async function claimNewsletterJob(
  db: Db,
  personId: string,
  publicationId: string,
  now: Date,
): Promise<NewsletterLease | null> {
  if (!/^pub_[A-Za-z0-9_-]{1,124}$/.test(publicationId) || !Number.isFinite(now.getTime()))
    throw new Error('Invalid newsletter lease configuration');
  const token = randomToken(),
    stamp = now.toISOString(),
    expires = new Date(now.getTime() + 30_000).toISOString();
  const result = await db
    .prepare(
      `UPDATE newsletter_sync_jobs SET state='running',lease_token=?,lease_expires_at=? WHERE person_id=? AND state IN ('queued','running','retry') AND next_attempt_at<=? AND (lease_expires_at IS NULL OR lease_expires_at<=?)`,
    )
    .bind(token, expires, personId, stamp, stamp)
    .run();
  if (!result.meta.changes) return null;
  const plan = await loadNewsletterPlan(db, personId);
  const lease: NewsletterLease = {
    personId,
    publicationId,
    token,
    accountKeys: plan ? await accountKeys(db, plan, publicationId) : [],
  };
  if (!plan) {
    await releaseNewsletterLease(db, lease);
    return null;
  }
  try {
    if (lease.accountKeys.length)
      await db
        .prepare(
          `INSERT INTO newsletter_account_leases(publication_id,account_key,token,expires_at) SELECT ?,value,?,? FROM json_each(?) WHERE 1 ON CONFLICT(publication_id,account_key) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE newsletter_account_leases.expires_at<=?`,
        )
        .bind(publicationId, token, expires, JSON.stringify(lease.accountKeys), stamp)
        .run();
    if (
      !(await newsletterLeaseIsCurrent(db, lease, now)) ||
      !(await newsletterPlanIsCurrent(db, plan))
    ) {
      await releaseNewsletterLease(db, lease);
      return null;
    }
    return lease;
  } catch (error) {
    await releaseNewsletterLease(db, lease);
    throw error;
  }
}

export function newsletterLeaseGuard(
  lease: NewsletterLease,
  now: Date,
): { sql: string; values: SqlValue[] } {
  return {
    sql: `EXISTS(SELECT 1 FROM newsletter_sync_jobs WHERE person_id=? AND lease_token=? AND lease_expires_at>? AND state IN ('queued','running','retry')) AND (SELECT count(*) FROM newsletter_account_leases WHERE publication_id=? AND token=? AND expires_at>? AND account_key IN (SELECT value FROM json_each(?)))=?`,
    values: [
      lease.personId,
      lease.token,
      now.toISOString(),
      lease.publicationId,
      lease.token,
      now.toISOString(),
      JSON.stringify(lease.accountKeys),
      lease.accountKeys.length,
    ],
  };
}

export async function newsletterLeaseIsCurrent(
  db: Db,
  lease: NewsletterLease,
  now: Date,
): Promise<boolean> {
  const guard = newsletterLeaseGuard(lease, now);
  return Boolean(
    await db
      .prepare(`SELECT 1 WHERE ${guard.sql}`)
      .bind(...guard.values)
      .first(),
  );
}

export async function saveNewsletterOutcome(
  db: Db,
  plan: NewsletterPlan,
  lease: NewsletterLease,
  outcome: NewsletterOutcome,
): Promise<boolean> {
  if (plan.personId !== lease.personId || !Number.isFinite(outcome.now.getTime())) return false;
  const planGuard = newsletterPlanGuard(plan),
    current = newsletterLeaseGuard(lease, outcome.now);
  const confirmed = outcome.kind === 'confirmed';
  const progress = outcome.kind === 'progress';
  const delay =
    confirmed || progress
      ? 0
      : Math.max(1000, Math.min(86_400_000, outcome.retryAfterMs ?? 60_000));
  const result = await db
    .prepare(
      `UPDATE newsletter_sync_jobs SET state=?,last_failure=?,attempts=attempts+?,next_attempt_at=?,last_publication_id=?,last_completed_at=CASE WHEN ? THEN ? ELSE last_completed_at END,activation_consent_id=CASE WHEN ? THEN NULL ELSE activation_consent_id END,activation_email_key=CASE WHEN ? THEN NULL ELSE activation_email_key END,activation_email_verified_at=CASE WHEN ? THEN NULL ELSE activation_email_verified_at END WHERE person_id=? AND ${planGuard.sql} AND ${current.sql}`,
    )
    .bind(
      confirmed ? 'done' : progress ? 'queued' : outcome.kind,
      'failure' in outcome ? outcome.failure : null,
      Number(!confirmed && !progress),
      new Date(outcome.now.getTime() + delay).toISOString(),
      lease.publicationId,
      Number(confirmed),
      outcome.now.toISOString(),
      Number(confirmed),
      Number(confirmed),
      Number(confirmed),
      plan.personId,
      ...planGuard.values,
      ...current.values,
    )
    .run();
  if (result.meta.changes) await releaseNewsletterLease(db, lease);
  return result.meta.changes === 1;
}

export async function pendingNewsletterPeople(db: Db, now: Date, limit = 25): Promise<string[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isFinite(now.getTime()))
    throw new Error('Invalid newsletter dispatch configuration');
  const stamp = now.toISOString();
  const { results } = await db
    .prepare(
      `SELECT person_id FROM newsletter_sync_jobs WHERE state IN ('queued','running','retry') AND next_attempt_at<=? AND (lease_expires_at IS NULL OR lease_expires_at<=?) ORDER BY next_attempt_at,requested_at,person_id LIMIT ?`,
    )
    .bind(stamp, stamp, limit)
    .all<{ person_id: string }>();
  return results.map((row) => row.person_id);
}
