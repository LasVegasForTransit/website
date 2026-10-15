import type { Db, SqlValue } from './db';

export interface RollRow {
  personId: string;
  status: string;
  observedAt: string;
  sourceCreatedAt: string | null;
  withdrawnAt: string | null;
  entitled: number;
  recognizedAt: string | null;
  revokedAt: string | null;
  reviewReason: string | null;
}
export interface RollContext {
  person: {
    email: string | null;
    deletedAt: string | null;
    erasedAt: string | null;
    version: number | null;
  } | null;
  identity: { personId: string; email: string | null } | null;
  roll: RollRow | null;
  active: string[];
  withdrawals: string[];
  duplicate: number;
  choice: number;
  outgoing: string | null;
}

export function eligibleRollContext(context: RollContext, personId: string, email: string) {
  const { person, identity, roll } = context;
  if (!person || !identity) return false;
  return (
    !person.deletedAt &&
    !person.erasedAt &&
    (person.version ?? 2) <= 2 &&
    person.email === email &&
    identity.personId === personId &&
    identity.email?.trim().toLowerCase() === email.trim().toLowerCase() &&
    (!roll || roll.personId === personId)
  );
}

const PERSON = '(SELECT person_id FROM selected)';
const EXTERNAL = '(SELECT external_id FROM selected)';
/** The same complete snapshot fences the mutation, including held choices by address. */
export const ROLL_CONTEXT = `WITH selected(person_id,external_id,email_key) AS (VALUES(?,?,?))
 SELECT json_object(
 'person',json((SELECT json_object('email',p.email,'deletedAt',coalesce(p.deleted_at,k.deleted_at),'erasedAt',k.erased_at,'version',p.membership_rules_version,'updatedAt',p.updated_at) FROM people p JOIN person_keys k ON k.id=p.id WHERE p.id=${PERSON})),
 'identity',json((SELECT json_object('personId',person_id,'email',external_email,'updatedAt',updated_at) FROM identities WHERE platform='beehiiv' AND external_id=${EXTERNAL})),
 'roll',json((SELECT json_object('personId',person_id,'status',status,'observedAt',observed_at,'sourceCreatedAt',source_created_at,'withdrawnAt',withdrawn_at,'entitled',entitled,'recognizedAt',recognized_at,'revokedAt',revoked_at,'reviewReason',review_reason,'revision',revision_token) FROM membership_roll WHERE external_id=${EXTERNAL})),
 'active',json((SELECT json_group_array(given_at) FROM (SELECT given_at FROM consent_records WHERE person_id=${PERSON} AND scope='newsletter' AND withdrawn_at IS NULL ORDER BY id))),
 'withdrawals',json((SELECT json_group_array(at) FROM (SELECT withdrawn_at AS at FROM consent_records WHERE person_id=${PERSON} AND scope='newsletter' AND withdrawn_at IS NOT NULL UNION SELECT withdrawn_at FROM consent_withdrawals WHERE (person_id=${PERSON} OR origin_person_id=${PERSON}) AND scope='newsletter' ORDER BY at))),
 'duplicate',(SELECT count(*) FROM review_queue WHERE resolved_at IS NULL AND (candidate_person_id=${PERSON} OR existing_person_id=${PERSON})),
 'choice',(SELECT count(*) FROM newsletter_inbound_events WHERE state IN ('pending','needs_review') AND (subscription_id=${EXTERNAL} OR email_key=(SELECT email_key FROM selected)))
  +(SELECT count(*) FROM newsletter_poll_choices WHERE state IN ('pending','needs_review') AND (subscription_id=${EXTERNAL} OR person_id=${PERSON}) AND status='inactive')
  +(SELECT count(*) FROM roster_import_records r WHERE state='held' AND person_id=${PERSON} AND EXISTS(SELECT 1 FROM json_each(r.reasons) reason WHERE reason.value NOT IN ('consent_unclear','consent_state_unknown','consent_timestamp_missing','newsletter_evidence_missing','newsletter_affirmative_missing'))),
 'outgoing',(SELECT max(started_at) FROM newsletter_write_attempts WHERE desired='inactive' AND (person_id=${PERSON} OR subscription_id=${EXTERNAL} OR account_key=(SELECT email_key FROM selected)))) AS snapshot`;

export async function loadRollContext(db: Db, values: SqlValue[]) {
  const row = await db
    .prepare(ROLL_CONTEXT)
    .bind(...values)
    .first<{ snapshot: string }>();
  return row ? { context: JSON.parse(row.snapshot) as RollContext, snapshot: row.snapshot } : null;
}
