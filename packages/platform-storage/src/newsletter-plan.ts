import type { Db, SqlValue } from './db';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';

export interface NewsletterIdentity {
  recordId: string;
  externalId: string;
  email: string | null;
  method: string;
}
export interface NewsletterPlan {
  personId: string;
  generation: number;
  email: string | null;
  deletedAt: string | null;
  erasedAt: string | null;
  desired: 'active' | 'inactive' | 'unknown';
  allowActivation: boolean;
  identities: NewsletterIdentity[];
  accountKeys: string[];
  snapshot: string;
}
interface Snapshot {
  generation: number;
  email: string | null;
  deletedAt: string | null;
  erasedAt: string | null;
  activationId: string | null;
  activationEmailKey: string | null;
  activationVerifiedAt: string | null;
  emailVerifiedAt: string | null;
  active: { id: string; givenAt: string; source: string }[];
  lastWithdrawal: string | null;
  roll: {
    entitled: number;
    observedAt: string;
    status: string;
    revokedAt: string | null;
    revision: string;
  }[];
  identities: NewsletterIdentity[];
}
const SNAPSHOT = `SELECT json_object('generation',j.generation,'email',p.email,
  'deletedAt',coalesce(p.deleted_at,k.deleted_at),'erasedAt',k.erased_at,'activationId',j.activation_consent_id,
  'activationEmailKey',j.activation_email_key,'activationVerifiedAt',j.activation_email_verified_at,'emailVerifiedAt',p.email_verified_at,
  'active',json((SELECT json_group_array(json_object('id',id,'givenAt',given_at,'source',source)) FROM (SELECT id,given_at,source FROM consent_records WHERE person_id=k.id AND scope='newsletter' AND withdrawn_at IS NULL ORDER BY id))),
  'roll',json((SELECT json_group_array(json_object('entitled',entitled,'observedAt',observed_at,'status',status,'revokedAt',revoked_at,'revision',revision_token)) FROM (SELECT * FROM membership_roll WHERE person_id=k.id ORDER BY external_id))),
  'lastWithdrawal',(SELECT at FROM (SELECT withdrawn_at AS at FROM consent_withdrawals WHERE (person_id=k.id OR origin_person_id=k.id) AND scope='newsletter' UNION ALL SELECT withdrawn_at AS at FROM consent_records WHERE person_id=k.id AND scope='newsletter' AND withdrawn_at IS NOT NULL) ORDER BY (julianday(at) IS NULL) DESC,julianday(at) DESC,at DESC LIMIT 1),
  'identities',json((SELECT json_group_array(json_object('recordId',id,'externalId',external_id,'email',external_email,'method',link_method)) FROM (SELECT * FROM identities WHERE person_id=k.id AND platform='beehiiv' ORDER BY id)))) AS snapshot
  FROM newsletter_sync_jobs j JOIN person_keys k ON k.id=j.person_id LEFT JOIN people p ON p.id=k.id WHERE j.person_id=?`;

async function activationAllowed(snapshot: Snapshot): Promise<boolean> {
  const consent = snapshot.active.find((value) => value.id === snapshot.activationId);
  if (!consent || !Number.isFinite(Date.parse(consent.givenAt))) return false;
  if (
    snapshot.lastWithdrawal &&
    !(Date.parse(consent.givenAt) > Date.parse(snapshot.lastWithdrawal))
  )
    return false;
  if (
    snapshot.activationEmailKey === null &&
    ['join_form', 'newsletter_box', 'google_form', 'external_form', 'account', 'paper'].includes(
      consent.source,
    )
  )
    return true;
  return Boolean(
    snapshot.email &&
    snapshot.activationVerifiedAt &&
    snapshot.activationVerifiedAt === snapshot.emailVerifiedAt &&
    snapshot.activationEmailKey === `email:${await digestToken(snapshot.email.toLowerCase())}` &&
    Date.parse(snapshot.activationVerifiedAt) >= Date.parse(consent.givenAt),
  );
}

export async function loadNewsletterPlan(db: Db, personId: string): Promise<NewsletterPlan | null> {
  const row = await db.prepare(SNAPSHOT).bind(personId).first<{ snapshot: string }>();
  if (!row) return null;
  const snapshot = JSON.parse(row.snapshot) as Snapshot;
  const allowActivation = await activationAllowed(snapshot);
  const emails = [snapshot.email, ...snapshot.identities.map((value) => value.email)].filter(
    (value): value is string => Boolean(value),
  );
  const accountKeys = [
    ...new Set([
      ...snapshot.identities.map((value) => `id:${value.externalId}`),
      ...(await Promise.all(
        emails.map(async (value) => `email:${await digestToken(value.trim().toLowerCase())}`),
      )),
    ]),
  ].sort();
  const desired =
    snapshot.deletedAt !== null
      ? 'inactive'
      : snapshot.active.length > 0
        ? 'active'
        : snapshot.lastWithdrawal || snapshot.roll.some((value) => value.revokedAt !== null)
          ? 'inactive'
          : snapshot.roll.some((value) => value.entitled === 1)
            ? 'active'
            : 'unknown';
  return {
    personId,
    generation: snapshot.generation,
    email: snapshot.email,
    deletedAt: snapshot.deletedAt,
    erasedAt: snapshot.erasedAt,
    desired,
    allowActivation,
    identities: snapshot.identities,
    accountKeys,
    snapshot: row.snapshot,
  };
}

const PENDING_SOURCE = `EXISTS(SELECT 1 FROM newsletter_inbound_events e WHERE e.publication_id=? AND e.state IN ('pending','needs_review') AND (e.email_key IN (SELECT value FROM json_each(?)) OR 'id:'||e.subscription_id IN (SELECT value FROM json_each(?)) OR e.email_key IN (SELECT account_key FROM newsletter_write_intents WHERE person_id=? AND publication_id=e.publication_id)))`;
const PENDING_POLL = `EXISTS(SELECT 1 FROM newsletter_poll_choices r WHERE r.publication_id=? AND r.status='inactive'
  AND r.state IN ('pending','needs_review') AND (r.person_id=? OR 'id:'||r.subscription_id IN (SELECT value FROM json_each(?)))
  AND NOT EXISTS(SELECT 1 FROM newsletter_sync_jobs j JOIN consent_records c ON c.id=j.activation_consent_id
    WHERE j.person_id=? AND c.person_id=j.person_id AND c.withdrawn_at IS NULL AND julianday(c.given_at)>julianday(r.observed_at)))`;
const PENDING_ROLL = `EXISTS(SELECT 1 FROM membership_roll WHERE person_id=? AND review_reason IN ('duplicate_review','pending_choice','choice_order_unknown','membership_status_unknown','newer_signup'))`;
function pendingValues(plan: NewsletterPlan, publicationId: string): SqlValue[] {
  const keys = JSON.stringify(plan.accountKeys);
  return [publicationId, keys, keys, plan.personId];
}
function pendingEvidence(plan: NewsletterPlan, publicationId: string) {
  if (plan.desired !== 'active')
    return {
      sql: `(${PENDING_SOURCE} OR ${PENDING_ROLL})`,
      values: [...pendingValues(plan, publicationId), plan.personId],
    };
  return {
    sql: `(${PENDING_SOURCE} OR ${PENDING_POLL} OR ${PENDING_ROLL})`,
    values: [
      ...pendingValues(plan, publicationId),
      publicationId,
      plan.personId,
      JSON.stringify(plan.accountKeys),
      plan.personId,
      plan.personId,
    ],
  };
}
export function newsletterPlanGuard(
  plan: NewsletterPlan,
  publicationId: string,
): { sql: string; values: SqlValue[] } {
  const pending = pendingEvidence(plan, publicationId);
  const inbound = plan.deletedAt === null ? ` AND NOT ${pending.sql}` : '';
  return {
    sql: `(${SNAPSHOT})=?${inbound}`,
    values: [plan.personId, plan.snapshot, ...(inbound ? pending.values : [])],
  };
}

/** Pending evidence delays this held account without starving the next account or recording success. */
export async function deferPendingNewsletterChoice(
  db: Db,
  plan: NewsletterPlan,
  lease: { token: string; publicationId: string },
  now: Date,
): Promise<boolean> {
  if (plan.deletedAt !== null) return false;
  const pending = pendingEvidence(plan, lease.publicationId);
  const result = await db
    .prepare(
      `UPDATE newsletter_sync_jobs SET state='queued',next_attempt_at=? WHERE person_id=? AND (${SNAPSHOT})=? AND lease_token=? AND lease_expires_at>? AND ${pending.sql}`,
    )
    .bind(
      new Date(now.getTime() + 60_000).toISOString(),
      plan.personId,
      plan.personId,
      plan.snapshot,
      lease.token,
      now.toISOString(),
      ...pending.values,
    )
    .run();
  return result.meta.changes > 0;
}

export async function newsletterPlanIsCurrent(
  db: Db,
  plan: NewsletterPlan,
  publicationId: string,
): Promise<boolean> {
  const guard = newsletterPlanGuard(plan, publicationId);
  return Boolean(
    await db
      .prepare(`SELECT 1 WHERE ${guard.sql}`)
      .bind(...guard.values)
      .first(),
  );
}
