import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db, SqlValue } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';

export interface NewsletterReviewRef {
  kind: 'poll' | 'event';
  id: string;
  revision: number;
}
export interface ReviewContext {
  review: {
    kind: 'poll' | 'event';
    id: string;
    revision: number;
    subscriptionId: string;
    status: 'active' | 'inactive';
    noticedAt: string;
    cutoff: string;
    state: string;
    reason: string | null;
    fingerprint: string | null;
    encryptedEmail: string | null;
    emailKey: string | null;
  } | null;
  owner: {
    id: string;
    name: string;
    email: string | null;
    verifiedAt: string | null;
    deletedAt: string | null;
    erasedAt: string | null;
    linkedAt: string;
    updatedAt: string;
  } | null;
  active: { id: string; givenAt: string }[];
  rollEntitled: number;
  lastWithdrawal: string | null;
  deliveryStatus: string | null;
  duplicate: number;
}
export const REVIEW_ROWS = `SELECT 'poll' AS kind,subscription_id AS id,revision,subscription_id AS subscriptionId,status,observed_at AS noticedAt,observed_at AS cutoff,state,reason,NULL AS fingerprint,NULL AS encryptedEmail,NULL AS emailKey
  FROM newsletter_poll_choices WHERE publication_id=?1
  UNION ALL SELECT 'event',e.id,1,e.subscription_id,CASE WHEN e.type='subscription.deleted' THEN 'inactive' ELSE 'active' END,e.received_at,
  e.occurred_at,e.state,o.reason,e.fingerprint,e.encrypted_email,e.email_key
  FROM newsletter_inbound_events e LEFT JOIN newsletter_source_operations o ON o.publication_id=e.publication_id AND o.event_id=e.id WHERE e.publication_id=?1`;
export function validReviewRef(ref: NewsletterReviewRef): boolean {
  return (
    ['poll', 'event'].includes(ref.kind) &&
    typeof ref.id === 'string' &&
    ref.id.length > 0 &&
    ref.id.length <= 200 &&
    Number.isSafeInteger(ref.revision) &&
    ref.revision > 0
  );
}
function contextSql(kind: NewsletterReviewRef['kind']): string {
  return `WITH selected AS (SELECT * FROM (${REVIEW_ROWS}) WHERE kind='${kind}' AND id=?2 AND revision=?3),
  selected_owner AS (SELECT i.person_id,i.linked_at,i.updated_at FROM identities i WHERE i.platform='beehiiv' AND i.external_id=(SELECT subscriptionId FROM selected))
  SELECT json_object('review',json((SELECT json_object('kind',kind,'id',id,'revision',revision,'subscriptionId',subscriptionId,'status',status,'noticedAt',noticedAt,'cutoff',cutoff,'state',state,'reason',reason,'fingerprint',fingerprint,'encryptedEmail',encryptedEmail,'emailKey',emailKey) FROM selected)),
    'owner',json((SELECT json_object('id',p.id,'name',coalesce(nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),''),p.email,'Name not recorded'),'email',p.email,'verifiedAt',p.email_verified_at,'deletedAt',coalesce(p.deleted_at,k.deleted_at),'erasedAt',k.erased_at,'linkedAt',o.linked_at,'updatedAt',o.updated_at) FROM selected_owner o JOIN person_keys k ON k.id=o.person_id LEFT JOIN people p ON p.id=o.person_id)),
    'deliveryStatus',(SELECT status FROM beehiiv_subscription_observations WHERE publication_id=?1 AND subscription_id=(SELECT subscriptionId FROM selected)),
    'active',json((SELECT json_group_array(json_object('id',id,'givenAt',given_at)) FROM (SELECT id,given_at FROM consent_records WHERE person_id=(SELECT person_id FROM selected_owner) AND scope='newsletter' AND withdrawn_at IS NULL ORDER BY id))),
    'rollEntitled',EXISTS(SELECT 1 FROM membership_roll WHERE person_id=(SELECT person_id FROM selected_owner) AND entitled=1),
    'lastWithdrawal',(SELECT max(at) FROM (SELECT withdrawn_at AS at FROM consent_records WHERE person_id=(SELECT person_id FROM selected_owner) AND scope='newsletter' UNION ALL SELECT withdrawn_at FROM consent_withdrawals WHERE (person_id=(SELECT person_id FROM selected_owner) OR origin_person_id=(SELECT person_id FROM selected_owner)) AND scope='newsletter')),
    'duplicate',(SELECT count(*) FROM review_queue WHERE resolved_at IS NULL AND (candidate_person_id=(SELECT person_id FROM selected_owner) OR existing_person_id=(SELECT person_id FROM selected_owner)))) AS snapshot WHERE ${STAFF_ADMIN_SCOPE}`;
}
export async function loadReviewContext(
  db: Db,
  actorId: string,
  publicationId: string,
  ref: NewsletterReviewRef,
) {
  if (!validReviewRef(ref) || !/^pub_[A-Za-z0-9_-]{1,124}$/.test(publicationId)) return null;
  const row = await db
    .prepare(contextSql(ref.kind))
    .bind(publicationId, ref.id, ref.revision, actorId)
    .first<{ snapshot: string }>();
  if (!row) return null;
  const context = JSON.parse(row.snapshot) as ReviewContext;
  if (
    context.review?.state !== 'needs_review' ||
    context.owner?.deletedAt ||
    context.owner?.erasedAt
  )
    return null;
  return { context, snapshot: row.snapshot, version: await digestToken(row.snapshot) };
}
export function reviewSnapshotGuard(
  actorId: string,
  publicationId: string,
  ref: NewsletterReviewRef,
  snapshot: string,
) {
  const values: SqlValue[] = [];
  const args = [publicationId, ref.id, ref.revision, actorId];
  const sql = contextSql(ref.kind).replace(/\?([123])/g, (_match, index: string) => {
    values.push(args[Number(index) - 1] ?? null);
    return '?';
  });
  // The administrator predicate uses the final unnumbered placeholder.
  values.push(actorId, snapshot);
  return { sql: `(${sql})=?`, values };
}
export function recordedChoiceAllowed(context: ReviewContext): boolean {
  const owner = context.owner,
    cutoff = Date.parse(context.review?.cutoff ?? '');
  if (
    !owner?.email ||
    !owner.verifiedAt ||
    owner.deletedAt ||
    owner.erasedAt ||
    context.duplicate ||
    sourceTimestampAmbiguous(context) ||
    !Number.isFinite(cutoff)
  )
    return false;
  return context.active.some(({ givenAt }) => {
    const at = Date.parse(givenAt),
      verified = Date.parse(owner.verifiedAt ?? '');
    return (
      Number.isFinite(at) &&
      at > cutoff &&
      at <= verified &&
      (!context.lastWithdrawal || at > Date.parse(context.lastWithdrawal))
    );
  });
}

function sourceTimestampAmbiguous(context: ReviewContext): boolean {
  const review = context.review;
  if (review?.kind !== 'event' || review.status !== 'inactive') return false;
  const at = Date.parse(review.cutoff);
  return (
    at % 1000 === 0 &&
    context.active.some((v) => Date.parse(v.givenAt) > at && Date.parse(v.givenAt) < at + 1000)
  );
}
export function mailingStatusAllowed(context: ReviewContext): boolean {
  const review = context.review;
  if (!context.owner?.id || !review || sourceTimestampAmbiguous(context)) return false;
  return (
    review.status === 'inactive' &&
    (review.kind === 'event' || context.deliveryStatus === 'inactive') &&
    context.active.every((v) => Date.parse(v.givenAt) <= Date.parse(review.cutoff))
  );
}
