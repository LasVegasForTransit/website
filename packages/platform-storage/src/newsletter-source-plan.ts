import type { Db, SqlValue } from './db';

export interface NewsletterSourceInput {
  publicationId: string;
  eventId: string;
  email: string;
  now: Date;
}
export interface SourceContext {
  event: {
    type: string;
    occurred_at: string;
    subscription_id: string;
    email_key: string;
    state: string;
  };
  owner: {
    id: string;
    email: string | null;
    deleted_at: string | null;
    erased_at: string | null;
    email_verified_at: string | null;
  } | null;
  candidate: {
    id: string;
    email: string;
    email_verified_at: string | null;
    deleted_at: null;
    erased_at: null;
  } | null;
  erasedAt: string | null;
  consents: { id: string; given_at: string; withdrawn_at: string | null }[];
  withdrawals: { withdrawn_at: string }[];
  sourceWithdrawals: { occurred_at: string }[];
  writes: { desired: 'active' | 'inactive'; started_at: string }[];
  review: number;
}

export const SOURCE_CONTEXT = `WITH source_event AS (SELECT * FROM newsletter_inbound_events WHERE publication_id=?1 AND id=?2),
  account_owner AS (SELECT i.person_id FROM identities i WHERE i.platform='beehiiv' AND i.external_id=(SELECT subscription_id FROM source_event)),
  candidate AS (SELECT p.id,p.email,p.email_verified_at FROM people p WHERE p.deleted_at IS NULL AND lower(p.email)=?3 AND NOT EXISTS(SELECT 1 FROM account_owner)),
  selected_person AS (SELECT person_id AS id FROM account_owner UNION SELECT id FROM candidate)
  SELECT json_object(
  'event',json((SELECT json_object('type',type,'occurred_at',occurred_at,'subscription_id',subscription_id,'email_key',email_key,'state',state,'encrypted_email',encrypted_email) FROM newsletter_inbound_events WHERE publication_id=?1 AND id=?2)),
  'owner',json((SELECT json_object('id',i.person_id,'email',p.email,'email_verified_at',p.email_verified_at,'deleted_at',k.deleted_at,'erased_at',k.erased_at) FROM identities i JOIN person_keys k ON k.id=i.person_id LEFT JOIN people p ON p.id=i.person_id WHERE i.platform='beehiiv' AND i.external_id=(SELECT subscription_id FROM newsletter_inbound_events WHERE publication_id=?1 AND id=?2))),
  'candidate',json((SELECT json_object('id',id,'email',email,'email_verified_at',email_verified_at,'deleted_at',NULL,'erased_at',NULL) FROM candidate)),
  'erasedAt',(SELECT erased_at FROM newsletter_address_tombstones WHERE email_key=(SELECT email_key FROM source_event)),
  'consents',json((SELECT json_group_array(json_object('id',id,'given_at',given_at,'withdrawn_at',withdrawn_at)) FROM (SELECT c.id,c.given_at,c.withdrawn_at FROM consent_records c WHERE c.person_id IN (SELECT id FROM selected_person) AND c.scope='newsletter' ORDER BY c.id))),
  'withdrawals',json((SELECT json_group_array(json_object('withdrawn_at',withdrawn_at)) FROM (SELECT w.withdrawn_at FROM consent_withdrawals w WHERE (w.person_id IN (SELECT id FROM selected_person) OR w.origin_person_id IN (SELECT id FROM selected_person)) AND w.scope='newsletter' ORDER BY w.id))),
  'sourceWithdrawals',json((SELECT json_group_array(json_object('occurred_at',occurred_at)) FROM (SELECT e.occurred_at FROM newsletter_inbound_events e WHERE e.publication_id=?1 AND e.type='subscription.deleted' AND e.state IN ('pending','needs_review','applied') AND e.id<>?2 AND (e.subscription_id=(SELECT subscription_id FROM source_event) OR e.email_key=(SELECT email_key FROM source_event)) ORDER BY e.id))),
  'writes',json((SELECT json_group_array(json_object('desired',desired,'started_at',started_at)) FROM (SELECT a.desired,a.started_at FROM newsletter_write_attempts a WHERE a.publication_id=?1 AND (a.subscription_id=(SELECT subscription_id FROM source_event) OR a.account_key=(SELECT email_key FROM source_event)) ORDER BY a.id))),
  'review',(SELECT count(*) FROM review_queue r WHERE (r.candidate_person_id IN (SELECT id FROM selected_person) OR r.existing_person_id IN (SELECT id FROM selected_person)) AND r.resolved_at IS NULL)
) AS snapshot`;

export async function loadNewsletterSourceContext(db: Db, input: NewsletterSourceInput) {
  const row = await db
    .prepare(SOURCE_CONTEXT)
    .bind(input.publicationId, input.eventId, input.email.trim().toLowerCase())
    .first<{ snapshot: string }>();
  if (!row) return null;
  const parsed = JSON.parse(row.snapshot) as Omit<SourceContext, 'event'> & {
    event: SourceContext['event'] | null;
  };
  if (parsed.event === null) return null;
  return { context: { ...parsed, event: parsed.event }, snapshot: row.snapshot };
}

export function sourceSnapshotGuard(
  input: NewsletterSourceInput,
  snapshot: string,
): { sql: string; values: SqlValue[] } {
  // Numbered placeholders belong to the nested query and are expanded for composition.
  const occurrences: SqlValue[] = [];
  const sql = SOURCE_CONTEXT.replace(/\?([123])/g, (_match, index: string) => {
    occurrences.push(
      index === '1'
        ? input.publicationId
        : index === '2'
          ? input.eventId
          : input.email.trim().toLowerCase(),
    );
    return '?';
  });
  return { sql: `(${sql})=?`, values: [...occurrences, snapshot] };
}
