import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db, SqlValue, Statement } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { PERSON_COLUMNS, type Person } from './person-service';
import type { FieldName } from './field-ownership';
export interface CorrectionWrite {
  operationId: string;
  actorId: string;
  person: Person;
  payload: string;
  reason: string;
  entries: [FieldName, SqlValue][];
  stamp: string;
  correctionId: string;
}
const FRESH = `EXISTS(SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=? AND kind='person.correct' AND payload=? AND applied_at IS NULL)`;
function fresh(input: CorrectionWrite): SqlValue[] {
  return [input.operationId, input.actorId, input.person.id, input.payload];
}
function insertReceipt(db: Db, input: CorrectionWrite): Statement {
  const before = input.entries
    .map(
      ([field]) =>
        `json_object('field','${field}','before',p.${field},'after',?,'beforeSource',(SELECT source FROM field_sources WHERE person_id=p.id AND field='${field}'))`,
    )
    .join(',');
  const current = input.entries.map(([field]) => `p.${field} IS ?`).join(' AND ');
  const email = input.entries.find(([field]) => field === 'email');
  return db
    .prepare(
      `INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,before_state,created_at)
    SELECT ?,?,'person.correct',?,?,json_array(${before}),? FROM people p WHERE p.id=? AND p.deleted_at IS NULL
    AND ${STAFF_ADMIN_SCOPE} AND p.updated_at=? AND ${current}
    AND NOT EXISTS(SELECT 1 FROM people other WHERE other.email=? AND other.id<>p.id AND other.deleted_at IS NULL)
    ON CONFLICT(operation_id) DO NOTHING`,
    )
    .bind(
      input.operationId,
      input.actorId,
      input.person.id,
      input.payload,
      ...input.entries.map(([, value]) => value),
      input.stamp,
      input.person.id,
      input.actorId,
      input.person.updated_at,
      ...input.entries.map(([field]) => input.person[field]),
      email?.[1] ?? null,
    );
}
function updatePerson(db: Db, input: CorrectionWrite): Statement {
  const changes = input.entries.map(([field]) => `${field}=?`);
  if (input.entries.some(([field]) => field === 'email')) changes.push('email_verified_at=NULL');
  if (input.entries.some(([field]) => field === 'zip'))
    changes.push(
      ...['region_id', 'region_source', 'region_set_at'].map(
        (field) =>
          `${field}=CASE WHEN region_source IN ('staff','member_choice') THEN ${field} ELSE NULL END`,
      ),
    );
  return db
    .prepare(`UPDATE people SET ${changes.join(',')},updated_at=? WHERE id=? AND ${FRESH}`)
    .bind(
      ...input.entries.map(([, value]) => value),
      input.stamp,
      input.person.id,
      ...fresh(input),
    );
}
function sourceWrites(db: Db, input: CorrectionWrite): Statement[] {
  return input.entries.map(([field]) =>
    db
      .prepare(
        `INSERT INTO field_sources(person_id,field,source,confirmed_at,created_at,updated_at)
    SELECT ?,?,'staff',?,?,? WHERE ${FRESH} ON CONFLICT(person_id,field) DO UPDATE SET source='staff',confirmed_at=excluded.confirmed_at,updated_at=excluded.updated_at`,
      )
      .bind(input.person.id, field, input.stamp, input.stamp, input.stamp, ...fresh(input)),
  );
}
function historyWrites(db: Db, input: CorrectionWrite): Statement[] {
  return [
    db
      .prepare(
        `INSERT INTO person_corrections(id,person_id,actor_id,reason,changes,operation_id,corrected_at)
      SELECT ?,?,?,?,before_state,?,? FROM staff_operations WHERE operation_id=? AND ${FRESH}`,
      )
      .bind(
        input.correctionId,
        input.person.id,
        input.actorId,
        input.reason,
        input.operationId,
        input.stamp,
        input.operationId,
        ...fresh(input),
      ),
    db
      .prepare(
        `INSERT INTO engagement_events(id,person_id,type,occurred_at,source,reference,details,created_at)
      SELECT ?,?,'correction',?,'staff',?,json_object('actorId',?,'reason',?,'changes',json(before_state)),?
      FROM staff_operations WHERE operation_id=? AND ${FRESH}`,
      )
      .bind(
        ulid(),
        input.person.id,
        input.stamp,
        input.correctionId,
        input.actorId,
        input.reason,
        input.stamp,
        input.operationId,
        ...fresh(input),
      ),
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at)
      SELECT ?,?,'person.correct',?,?,?,? WHERE ${FRESH}`,
      )
      .bind(
        ulid(),
        input.actorId,
        input.person.id,
        JSON.stringify({ reason: input.reason, correctionId: input.correctionId }),
        input.operationId,
        input.stamp,
        ...fresh(input),
      ),
  ];
}
function reconcileWrites(db: Db, input: CorrectionWrite): Statement[] {
  return [
    db
      .prepare(
        `INSERT INTO reconcile_generations(person_id,target_id,generation) SELECT ?,'person',1 WHERE ${FRESH}
      ON CONFLICT(person_id,target_id) DO UPDATE SET generation=generation+1`,
      )
      .bind(input.person.id, ...fresh(input)),
    db
      .prepare(
        `INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
      SELECT ?,'person_reconcile',?,'person',generation,'{}',?,?,? FROM reconcile_generations WHERE person_id=? AND target_id='person' AND ${FRESH}`,
      )
      .bind(
        input.operationId,
        input.person.id,
        input.stamp,
        input.stamp,
        input.stamp,
        input.person.id,
        ...fresh(input),
      ),
  ];
}
export function correctionWrites(db: Db, input: CorrectionWrite): Statement[] {
  const sessions = input.entries.some(([field]) => field === 'email')
    ? ['sessions', 'sign_in_codes'].map((table) =>
        db
          .prepare(`DELETE FROM ${table} WHERE person_id=? AND ${FRESH}`)
          .bind(input.person.id, ...fresh(input)),
      )
    : [];
  const result = PERSON_COLUMNS.split(', ')
    .map((field) => `'${field}',p.${field}`)
    .join(',');
  return [
    insertReceipt(db, input),
    updatePerson(db, input),
    ...sourceWrites(db, input),
    ...sessions,
    ...historyWrites(db, input),
    ...reconcileWrites(db, input),
    db
      .prepare(
        `UPDATE staff_operations SET result=(SELECT json_object(${result}) FROM people p WHERE p.id=?),applied_at=? WHERE operation_id=? AND ${FRESH}`,
      )
      .bind(input.person.id, input.stamp, input.operationId, ...fresh(input)),
  ];
}
