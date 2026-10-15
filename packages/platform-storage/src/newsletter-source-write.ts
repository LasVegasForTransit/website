import { MEMBERSHIP_STATUS_SQL, CURRENT_MEMBERSHIP_VERSION } from './membership-policy';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db, Statement, SqlValue } from './db';
import {
  sourceSnapshotGuard,
  type NewsletterSourceInput,
  type SourceContext,
} from './newsletter-source-plan';
import type { SourceDecision } from './newsletter-source-choice';
import type { SourcePerson } from './newsletter-source-person';

interface SourceTransaction {
  input: NewsletterSourceInput;
  context: SourceContext;
  snapshot: string;
  address: string;
  decision: SourceDecision;
  person: SourcePerson;
  nonce: string;
  stamp: string;
}
function mutation(db: Db, tx: SourceTransaction, sql: string, values: SqlValue[]): Statement {
  return db
    .prepare(
      sql.replaceAll(
        '__HELD__',
        'EXISTS(SELECT 1 FROM newsletter_source_operations WHERE nonce=?)',
      ),
    )
    .bind(...values, tx.nonce);
}
function startOperation(db: Db, tx: SourceTransaction): Statement {
  const guard = sourceSnapshotGuard(tx.input, tx.snapshot);
  return db
    .prepare(
      `INSERT INTO newsletter_source_operations(publication_id,event_id,nonce,person_id,outcome,reason,created_at)
    SELECT ?,?,?,?,?,?,? WHERE ${guard.sql} ON CONFLICT(publication_id,event_id) DO NOTHING`,
    )
    .bind(
      tx.input.publicationId,
      tx.input.eventId,
      tx.nonce,
      null,
      tx.decision.kind,
      tx.decision.reason,
      tx.stamp,
      ...guard.values,
    );
}
function preparePerson(db: Db, tx: SourceTransaction): Statement[] {
  const { personId, create } = tx.person;
  if (!personId) return [];
  const statements: Statement[] = [],
    at = tx.context.event.occurred_at;
  if (create)
    statements.push(
      mutation(
        db,
        tx,
        `INSERT INTO people(id,email,email_verified_at,created_at,updated_at)
      SELECT ?,?,?,?,? WHERE __HELD__`,
        [personId, tx.address, at, tx.stamp, tx.stamp],
      ),
      mutation(
        db,
        tx,
        `INSERT INTO field_sources(person_id,field,source,confirmed_at,created_at,updated_at)
      SELECT ?,'email','beehiiv',?,?,? WHERE __HELD__`,
        [personId, at, tx.stamp, tx.stamp],
      ),
    );
  if (!tx.context.owner)
    statements.push(
      mutation(
        db,
        tx,
        `INSERT INTO identities(id,person_id,platform,external_id,external_email,linked_at,link_method,created_at,updated_at)
    SELECT ?,?,'beehiiv',?,?,?,'verified_email',?,? WHERE __HELD__`,
        [
          ulid(),
          personId,
          tx.context.event.subscription_id,
          tx.address,
          tx.stamp,
          tx.stamp,
          tx.stamp,
        ],
      ),
    );
  return statements;
}
function writeChoice(db: Db, tx: SourceTransaction): Statement[] {
  const { personId } = tx.person;
  if (!personId) return [];
  const at = tx.context.event.occurred_at;
  if (tx.context.event.type === 'subscription.confirmed')
    return [
      mutation(
        db,
        tx,
        `INSERT INTO consent_records(id,person_id,scope,given_at,source,method,wording_version,created_at,updated_at)
    SELECT ?,?,'newsletter',?,'beehiiv','double_opt_in',NULL,?,? WHERE __HELD__`,
        [ulid(), personId, at, tx.stamp, tx.stamp],
      ),
    ];
  return [
    mutation(
      db,
      tx,
      `INSERT INTO consent_withdrawals(id,person_id,origin_person_id,scope,source,withdrawn_at,recorded_at)
      SELECT ?,?,?,'newsletter','beehiiv',?,? WHERE __HELD__ ON CONFLICT(origin_person_id,scope,source,withdrawn_at) DO NOTHING`,
      [ulid(), personId, personId, at, tx.stamp],
    ),
    mutation(
      db,
      tx,
      `UPDATE consent_records SET withdrawn_at=?,withdrawn_source='beehiiv',updated_at=?
      WHERE person_id=? AND scope='newsletter' AND withdrawn_at IS NULL AND julianday(given_at)<=julianday(?) AND __HELD__`,
      [at, tx.stamp, personId, at],
    ),
  ];
}
function writeHistoryAndMembership(db: Db, tx: SourceTransaction): Statement[] {
  const { personId } = tx.person;
  if (!personId) return [];
  const event = tx.context.event;
  return [
    mutation(
      db,
      tx,
      `INSERT INTO engagement_events(id,person_id,type,occurred_at,source,reference,details,created_at)
      SELECT ?,?,?,?,'beehiiv',?,?,? WHERE __HELD__`,
      [
        ulid(),
        personId,
        event.type === 'subscription.confirmed' ? 'subscribed' : 'unsubscribed',
        event.occurred_at,
        `${event.subscription_id}:${tx.input.eventId}`,
        JSON.stringify({ subscriptionId: event.subscription_id, eventId: tx.input.eventId }),
        tx.stamp,
      ],
    ),
    mutation(
      db,
      tx,
      `UPDATE people SET membership_status=${MEMBERSHIP_STATUS_SQL},membership_rules_version=${CURRENT_MEMBERSHIP_VERSION},updated_at=? WHERE id=? AND __HELD__`,
      [tx.stamp, personId],
    ),
  ];
}
function finishOperation(db: Db, tx: SourceTransaction): Statement[] {
  const { personId } = tx.person;
  return [
    ...(personId
      ? [
          db
            .prepare(
              'UPDATE newsletter_source_operations SET person_id=? WHERE publication_id=? AND event_id=? AND nonce=?',
            )
            .bind(personId, tx.input.publicationId, tx.input.eventId, tx.nonce),
        ]
      : []),
    mutation(
      db,
      tx,
      `UPDATE newsletter_inbound_events SET state=?,encrypted_email=CASE WHEN ?='needs_review' THEN encrypted_email ELSE NULL END
      WHERE publication_id=? AND id=? AND state='pending' AND __HELD__`,
      [tx.decision.kind, tx.decision.kind, tx.input.publicationId, tx.input.eventId],
    ),
  ];
}
export function newsletterSourceStatements(db: Db, tx: SourceTransaction): Statement[] {
  return [
    startOperation(db, tx),
    ...(tx.decision.kind === 'applied'
      ? [...preparePerson(db, tx), ...writeChoice(db, tx), ...writeHistoryAndMembership(db, tx)]
      : []),
    ...finishOperation(db, tx),
  ];
}
