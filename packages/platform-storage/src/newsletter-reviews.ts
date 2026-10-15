import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Actor, Page } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db, SqlValue } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { InvalidCursor } from './staff-history';
import { auditDenied } from './audits';
import {
  loadReviewContext,
  recordedChoiceAllowed,
  mailingStatusAllowed,
  REVIEW_ROWS,
  type NewsletterReviewRef,
} from './newsletter-review-context';
export { resolveNewsletterReview } from './newsletter-review-writes';
export { validReviewRef } from './newsletter-review-context';
export type { NewsletterReviewRef } from './newsletter-review-context';
export interface NewsletterReviewRow extends NewsletterReviewRef {
  subscriptionId: string;
  status: 'active' | 'inactive';
  noticedAt: string;
  reason: string | null;
  personId: string | null;
  name: string | null;
  email: string | null;
}
async function admin(db: Db, actorId: string) {
  return Boolean(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actorId).first());
}
function decodeCursor(value: string): [string, string, string] {
  try {
    if (value.length > 700 || !/^[\w-]+$/.test(value)) throw new InvalidCursor();
    const data: unknown = JSON.parse(atob(value.replaceAll('-', '+').replaceAll('_', '/')));
    if (
      !Array.isArray(data) ||
      data.length !== 3 ||
      data.some((v) => typeof v !== 'string') ||
      !Number.isFinite(Date.parse(data[0] as string))
    )
      throw new InvalidCursor();
    return data as [string, string, string];
  } catch {
    throw new InvalidCursor();
  }
}
export async function listNewsletterReviews(
  db: Db,
  actor: Actor,
  publicationId: string,
  query: { cursor?: string; limit?: number },
): Promise<Page<NewsletterReviewRow>> {
  if (!(await admin(db, actor.personId))) {
    await auditDenied(db, actor.personId, 'newsletter.review');
    throw new PermissionDenied('newsletter.review');
  }
  if (!/^pub_[A-Za-z0-9_-]{1,124}$/.test(publicationId))
    throw new Error('Invalid newsletter publication');
  const where = [
      "r.state='needs_review'",
      'p.deleted_at IS NULL',
      'k.erased_at IS NULL',
      STAFF_ADMIN_SCOPE,
    ],
    values: SqlValue[] = [publicationId, actor.personId];
  if (query.cursor) {
    const [date, kind, id] = decodeCursor(query.cursor);
    where.push('(r.noticedAt>? OR (r.noticedAt=? AND (r.kind>? OR (r.kind=? AND r.id>?))))');
    values.push(date, date, kind, kind, id);
  }
  const limit = Number.isFinite(query.limit)
    ? Math.max(1, Math.min(50, Math.floor(query.limit ?? 25)))
    : 25;
  const { results } = await db
    .prepare(
      `SELECT r.kind,r.id,r.revision,r.subscriptionId,r.status,r.noticedAt,r.reason,p.id AS personId,
    coalesce(nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),''),p.email) AS name,p.email FROM (${REVIEW_ROWS}) r
    LEFT JOIN identities i ON i.platform='beehiiv' AND i.external_id=r.subscriptionId LEFT JOIN person_keys k ON k.id=i.person_id LEFT JOIN people p ON p.id=i.person_id
    WHERE ${where.join(' AND ')} ORDER BY r.noticedAt,r.kind,r.id LIMIT ?`,
    )
    .bind(...values, limit + 1)
    .all<NewsletterReviewRow>();
  const items = results.slice(0, limit),
    last = items.at(-1);
  return {
    items,
    nextCursor:
      results.length > limit && last
        ? btoa(JSON.stringify([last.noticedAt, last.kind, last.id]))
            .replaceAll('+', '-')
            .replaceAll('/', '_')
            .replaceAll('=', '')
        : null,
  };
}
export async function newsletterReview(
  db: Db,
  actor: Actor,
  publicationId: string,
  ref: NewsletterReviewRef,
) {
  const loaded = await loadReviewContext(db, actor.personId, publicationId, ref);
  if (!loaded?.context.review) return null;
  const { context, version } = loaded,
    review = loaded.context.review,
    owner = context.owner;
  return {
    ...ref,
    subscriptionId: review.subscriptionId,
    status: review.status,
    noticedAt: review.noticedAt,
    reason: review.reason,
    personId: owner?.id ?? null,
    name: owner?.name ?? null,
    email: owner?.email ?? null,
    membership: context.active.length ? 'member' : 'former_member',
    latestSignupAt:
      context.active
        .map((v) => v.givenAt)
        .sort()
        .at(-1) ?? null,
    canUseRecordedChoice: recordedChoiceAllowed(context),
    canUseMailingStatus: mailingStatusAllowed(context),
    version,
    encryptedEmail: review.encryptedEmail,
    emailKey: review.emailKey,
  };
}
export type NewsletterReviewDetail = Omit<
  NonNullable<Awaited<ReturnType<typeof newsletterReview>>>,
  'encryptedEmail' | 'emailKey'
>;
