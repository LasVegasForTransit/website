import type { Db, SqlValue } from './db';

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
  desired: 'active' | 'inactive' | 'unknown';
  allowActivation: boolean;
  identities: NewsletterIdentity[];
  snapshot: string;
}
interface Snapshot {
  generation: number;
  email: string | null;
  deletedAt: string | null;
  activationId: string | null;
  active: { id: string; givenAt: string; source: string }[];
  lastWithdrawal: string | null;
  identities: NewsletterIdentity[];
}
const SNAPSHOT = `SELECT json_object('generation',j.generation,'email',p.email,
  'deletedAt',coalesce(p.deleted_at,k.deleted_at),'activationId',j.activation_consent_id,
  'active',json((SELECT json_group_array(json_object('id',id,'givenAt',given_at,'source',source)) FROM (SELECT id,given_at,source FROM consent_records WHERE person_id=k.id AND scope='newsletter' AND withdrawn_at IS NULL ORDER BY id))),
  'lastWithdrawal',(SELECT at FROM (SELECT withdrawn_at AS at FROM consent_withdrawals WHERE (person_id=k.id OR origin_person_id=k.id) AND scope='newsletter' UNION ALL SELECT withdrawn_at AS at FROM consent_records WHERE person_id=k.id AND scope='newsletter' AND withdrawn_at IS NOT NULL) ORDER BY (julianday(at) IS NULL) DESC,julianday(at) DESC,at DESC LIMIT 1),
  'identities',json((SELECT json_group_array(json_object('recordId',id,'externalId',external_id,'email',external_email,'method',link_method)) FROM (SELECT * FROM identities WHERE person_id=k.id AND platform='beehiiv' ORDER BY id)))) AS snapshot
  FROM newsletter_sync_jobs j JOIN person_keys k ON k.id=j.person_id LEFT JOIN people p ON p.id=k.id WHERE j.person_id=?`;

export async function loadNewsletterPlan(db: Db, personId: string): Promise<NewsletterPlan | null> {
  const row = await db.prepare(SNAPSHOT).bind(personId).first<{ snapshot: string }>();
  if (!row) return null;
  const snapshot = JSON.parse(row.snapshot) as Snapshot;
  const consent = snapshot.active.find((value) => value.id === snapshot.activationId);
  const allowActivation = Boolean(
    consent &&
    ['join_form', 'newsletter_box', 'google_form', 'external_form', 'account', 'paper'].includes(
      consent.source,
    ) &&
    Number.isFinite(Date.parse(consent.givenAt)) &&
    (!snapshot.lastWithdrawal || Date.parse(consent.givenAt) > Date.parse(snapshot.lastWithdrawal)),
  );
  const desired =
    snapshot.deletedAt !== null
      ? 'inactive'
      : snapshot.active.length > 0
        ? 'active'
        : snapshot.lastWithdrawal
          ? 'inactive'
          : 'unknown';
  return {
    personId,
    generation: snapshot.generation,
    email: snapshot.email,
    deletedAt: snapshot.deletedAt,
    desired,
    allowActivation,
    identities: snapshot.identities,
    snapshot: row.snapshot,
  };
}

export function newsletterPlanGuard(plan: NewsletterPlan): { sql: string; values: SqlValue[] } {
  return { sql: `(${SNAPSHOT})=?`, values: [plan.personId, plan.snapshot] };
}

export async function newsletterPlanIsCurrent(db: Db, plan: NewsletterPlan): Promise<boolean> {
  const guard = newsletterPlanGuard(plan);
  return Boolean(
    await db
      .prepare(`SELECT 1 WHERE ${guard.sql}`)
      .bind(...guard.values)
      .first(),
  );
}
