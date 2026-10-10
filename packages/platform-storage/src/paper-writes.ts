import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { paperDayStarts, type PaperInput } from '@lasvegasfortransit/platform-core/paper';
import type { Db, Statement } from './db';
import { PAPER_SCOPE, type PaperRecord } from './paper-plan';
export interface PaperWrite {
  input: PaperInput;
  records: PaperRecord[];
  actorId: string;
  hash: string;
  stamp: string;
}
export const PAPER_FRESH = `EXISTS(SELECT 1 FROM paper_batches WHERE id=? AND actor_id=? AND payload_hash=? AND applied_at IS NULL)`;
export function paperFresh(input: PaperWrite) {
  return [input.input.batchId, input.actorId, input.hash];
}
function receipt(db: Db, c: PaperWrite): Statement {
  return db
    .prepare(
      `INSERT INTO paper_batches(id,actor_id,event_id,event_name,event_date,wording_version,payload_hash,created_at)
 SELECT ?,?,?,?,?,?,?,? WHERE ${PAPER_SCOPE} AND ${c.records.map((r) => r.check.sql).join(' AND ')} ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      c.input.batchId,
      c.actorId,
      c.input.eventId,
      c.input.eventName.trim(),
      c.input.eventDate,
      c.input.wordingVersion,
      c.hash,
      c.stamp,
      c.actorId,
      ...c.records.flatMap((r) => r.check.values),
    );
}
function contact(db: Db, c: PaperWrite, r: PaperRecord): Statement[] {
  const fields = JSON.stringify(r.fields),
    fresh = paperFresh(c);
  const person = r.create
    ? db
        .prepare(
          `INSERT INTO people(id,given_name,family_name,email,phone,created_at,updated_at)
 SELECT ?,json_extract(?,'$.given_name'),json_extract(?,'$.family_name'),json_extract(?,'$.email'),json_extract(?,'$.phone'),?,? WHERE ${PAPER_FRESH}`,
        )
        .bind(r.personId, fields, fields, fields, fields, c.stamp, c.stamp, ...fresh)
    : db
        .prepare(
          `UPDATE people SET given_name=coalesce(given_name,json_extract(?,'$.given_name')),family_name=coalesce(family_name,json_extract(?,'$.family_name')),email=coalesce(email,json_extract(?,'$.email')),phone=coalesce(phone,json_extract(?,'$.phone')),updated_at=? WHERE id=? AND deleted_at IS NULL AND ${PAPER_FRESH}`,
        )
        .bind(fields, fields, fields, fields, c.stamp, r.personId, ...fresh);
  return [
    person,
    db
      .prepare(
        `INSERT INTO field_sources(person_id,field,source,confirmed_at,created_at,updated_at) SELECT ?,key,'paper',?,?,? FROM json_each(?) WHERE ${PAPER_FRESH} ON CONFLICT(person_id,field) DO UPDATE SET source=excluded.source,confirmed_at=excluded.confirmed_at,updated_at=excluded.updated_at`,
      )
      .bind(r.personId, c.stamp, c.stamp, c.stamp, fields, ...fresh),
  ];
}
function consent(db: Db, c: PaperWrite, r: PaperRecord): Statement[] {
  if (!r.row.newsletterConsent) return [];
  const given = `${c.input.eventDate}T12:00:00.000Z`;
  const dayStarts = paperDayStarts(c.input.eventDate);
  return [
    db
      .prepare(
        `WITH withdrawal AS (SELECT withdrawn_at,source FROM consent_withdrawals WHERE (person_id=? OR origin_person_id=?) AND scope='newsletter' AND julianday(withdrawn_at)>=julianday(?) UNION ALL SELECT withdrawn_at,withdrawn_source FROM consent_records WHERE person_id=? AND scope='newsletter' AND withdrawn_at IS NOT NULL AND julianday(withdrawn_at)>=julianday(?))
 INSERT INTO consent_records(id,person_id,scope,given_at,source,method,wording_version,withdrawn_at,withdrawn_source,created_at,updated_at)
 SELECT ?,?,'newsletter',?,'paper','checkbox',?,(SELECT withdrawn_at FROM withdrawal ORDER BY withdrawn_at DESC LIMIT 1),(SELECT source FROM withdrawal ORDER BY withdrawn_at DESC LIMIT 1),?,? WHERE ${PAPER_FRESH} AND NOT EXISTS(SELECT 1 FROM consent_records WHERE person_id=? AND scope='newsletter' AND withdrawn_at IS NULL)`,
      )
      .bind(
        r.personId,
        r.personId,
        dayStarts,
        r.personId,
        dayStarts,
        r.consentId,
        r.personId,
        given,
        c.input.wordingVersion,
        c.stamp,
        c.stamp,
        ...paperFresh(c),
        r.personId,
      ),
    db
      .prepare(
        `INSERT INTO engagement_events(id,person_id,type,occurred_at,source,reference,details,created_at) SELECT ?,?,'subscribed',?,'paper',?,?,? WHERE ${PAPER_FRESH} AND EXISTS(SELECT 1 FROM consent_records WHERE id=?)`,
      )
      .bind(
        ulid(),
        r.personId,
        given,
        r.consentId,
        JSON.stringify({
          actorId: c.actorId,
          wordingVersion: c.input.wordingVersion,
          datePrecision: 'day',
        }),
        c.stamp,
        ...paperFresh(c),
        r.consentId,
      ),
  ];
}
function attendance(db: Db, c: PaperWrite, r: PaperRecord): Statement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO engagement_events(id,person_id,type,occurred_at,source,reference,details,created_at) SELECT ?,?,'attended',?,'paper',?,?,? WHERE ${PAPER_FRESH}`,
    )
    .bind(
      ulid(),
      r.personId,
      `${c.input.eventDate}T12:00:00.000Z`,
      c.input.eventId,
      JSON.stringify({
        actorId: c.actorId,
        eventName: c.input.eventName,
        eventDate: c.input.eventDate,
        datePrecision: 'day',
        wordingVersion: c.input.wordingVersion,
        batchId: c.input.batchId,
        newsletterConsent: r.row.newsletterConsent,
      }),
      c.stamp,
      ...paperFresh(c),
    );
}
function reviews(db: Db, c: PaperWrite, r: PaperRecord): Statement[] {
  if (!r.create) return [];
  const writes: Statement[] = [];
  for (const reason of ['same email, unverified', 'same phone'] as const) {
    const email = reason === 'same email, unverified';
    const value = email
      ? r.withholdEmail
        ? r.row.email.trim().toLowerCase()
        : null
      : (r.fields.phone ?? null);
    writes.push(
      db
        .prepare(
          `INSERT INTO review_queue(id,candidate_person_id,existing_person_id,reason,details,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),?,p.id,?,?,?,? FROM people p WHERE p.id<>? AND p.deleted_at IS NULL AND p.${email ? 'email' : 'phone'}=? AND ${PAPER_FRESH}
 AND NOT EXISTS(SELECT 1 FROM review_queue WHERE resolution='kept_separate' AND ((candidate_person_id=? AND existing_person_id=p.id) OR (existing_person_id=? AND candidate_person_id=p.id))) LIMIT 5 ON CONFLICT(candidate_person_id,existing_person_id,reason) DO NOTHING`,
        )
        .bind(
          r.personId,
          reason,
          email ? JSON.stringify({ email: value }) : null,
          c.stamp,
          c.stamp,
          r.personId,
          value,
          ...paperFresh(c),
          r.personId,
          r.personId,
        ),
    );
  }
  return writes;
}
export function paperWrites(db: Db, c: PaperWrite): Statement[] {
  const personIds = JSON.stringify(c.records.map((r) => r.personId));
  const consentIds = JSON.stringify(
    c.records.filter((r) => r.row.newsletterConsent).map((r) => r.consentId),
  );
  return [
    receipt(db, c),
    ...c.records.flatMap((r) => [
      ...contact(db, c, r),
      ...consent(db, c, r),
      attendance(db, c, r),
      ...reviews(db, c, r),
    ]),
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at) SELECT ?,?,'paper.import',?,?,?,? WHERE ${PAPER_FRESH}`,
      )
      .bind(
        ulid(),
        c.actorId,
        c.input.batchId,
        JSON.stringify({
          eventId: c.input.eventId,
          rowCount: c.records.length,
          wordingVersion: c.input.wordingVersion,
        }),
        `paper:${c.input.batchId}`,
        c.stamp,
        ...paperFresh(c),
      ),
    db
      .prepare(
        `UPDATE paper_batches SET applied_at=?,result=json_object('personIds',json(?),'reviewIds',json((SELECT coalesce(json_group_array(id),'[]') FROM review_queue WHERE candidate_person_id IN (SELECT value FROM json_each(?)) AND created_at=?)),'withdrawalHeldIds',json((SELECT coalesce(json_group_array(c.person_id),'[]') FROM consent_records c JOIN people p ON p.id=c.person_id WHERE c.id IN (SELECT value FROM json_each(?)) AND c.withdrawn_at IS NOT NULL AND p.membership_status='former_member'))) WHERE id=? AND ${PAPER_FRESH}`,
      )
      .bind(c.stamp, personIds, personIds, c.stamp, consentIds, c.input.batchId, ...paperFresh(c)),
  ];
}
