import type { Db, Statement } from './db';
import { rowValue, RELATED_TABLES, type MergeBookkeeping, type MergeRow } from './merge-state';
import {
  FRESH_MERGE,
  freshMerge,
  type MergeOperation,
  finishMerge,
  invalidateMergedAccess,
  recomputeMergeMembership,
  mergeReconciliation,
} from './merge-operations';
export function sourceRestore(
  db: Db,
  input: MergeOperation,
  field: string,
  source: MergeRow | null,
): Statement {
  if (!source)
    return db
      .prepare(`DELETE FROM field_sources WHERE person_id=? AND field=? AND ${FRESH_MERGE}`)
      .bind(input.survivorId, field, ...freshMerge(input));
  return db
    .prepare(
      `INSERT INTO field_sources(person_id,field,source,confirmed_at,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE ${FRESH_MERGE}
    ON CONFLICT(person_id,field) DO UPDATE SET source=excluded.source,confirmed_at=excluded.confirmed_at,created_at=excluded.created_at,updated_at=excluded.updated_at`,
    )
    .bind(
      input.survivorId,
      field,
      rowValue(source, 'source'),
      rowValue(source, 'confirmed_at'),
      rowValue(source, 'created_at'),
      rowValue(source, 'updated_at'),
      ...freshMerge(input),
    );
}
export function ownershipWrites(
  db: Db,
  input: MergeOperation,
  book: MergeBookkeeping,
): Statement[] {
  const forward = input.kind === 'person.merge';
  return Object.entries(RELATED_TABLES).map(([table, spec]) =>
    db
      .prepare(
        `UPDATE ${table} SET person_id=? WHERE person_id=? AND ${spec.key} IN (
      SELECT json_extract(value,'$.key') FROM json_each(?) WHERE json_extract(value,'$.table')=?) AND ${FRESH_MERGE}`,
      )
      .bind(
        forward ? input.survivorId : input.mergedId,
        forward ? input.mergedId : input.survivorId,
        JSON.stringify(book.rows),
        table,
        ...freshMerge(input),
      ),
  );
}
function fillPerson(db: Db, input: MergeOperation, book: MergeBookkeeping): Statement[] {
  if (!book.fields.length) return [];
  return [
    db
      .prepare(
        `UPDATE people SET ${book.fields.map((field) => `${field.field}=?`).join(',')},updated_at=? WHERE id=? AND ${FRESH_MERGE}`,
      )
      .bind(
        ...book.fields.map((field) => field.after),
        input.stamp,
        input.survivorId,
        ...freshMerge(input),
      ),
    ...book.fields
      .filter((field) => field.afterSource)
      .map((field) => sourceRestore(db, input, field.field, field.afterSource)),
  ];
}
function resolveMergeReviews(db: Db, input: MergeOperation, book: MergeBookkeeping): Statement[] {
  // Reviews involving the archived entry cease to be actionable. Keep their original IDs and pair.
  return book.reviews
    .filter(
      (row) =>
        row.candidate_person_id === input.mergedId || row.existing_person_id === input.mergedId,
    )
    .map((row) =>
      db
        .prepare(
          `UPDATE review_queue SET resolved_at=?,resolved_by=?,resolution='merged',updated_at=? WHERE id=? AND ${FRESH_MERGE}`,
        )
        .bind(input.stamp, input.actorId, input.stamp, rowValue(row, 'id'), ...freshMerge(input)),
    );
}
export function mergeWrites(db: Db, input: MergeOperation, book: MergeBookkeeping): Statement[] {
  const admin = book.copiedAdmin;
  return [
    db
      .prepare(
        `INSERT INTO merges(id,surviving_person_id,merged_person_id,merged_at,merged_by,moved_rows,created_at,updated_at,operation_id,reason)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${FRESH_MERGE}`,
      )
      .bind(
        input.id,
        input.survivorId,
        input.mergedId,
        input.stamp,
        input.actorId,
        JSON.stringify(book),
        input.stamp,
        input.stamp,
        input.operationId,
        input.reason,
        ...freshMerge(input),
      ),
    ...(admin
      ? [
          db
            .prepare(
              `INSERT INTO staff_administrators(person_id,designated_by,designated_at) SELECT ?,?,? WHERE ${FRESH_MERGE}`,
            )
            .bind(
              input.survivorId,
              rowValue(admin, 'designated_by'),
              rowValue(admin, 'designated_at'),
              ...freshMerge(input),
            ),
        ]
      : []),
    db
      .prepare(`UPDATE people SET deleted_at=?,updated_at=? WHERE id=? AND ${FRESH_MERGE}`)
      .bind(input.stamp, input.stamp, input.mergedId, ...freshMerge(input)),
    ...ownershipWrites(db, input, book),
    ...book.suppressed.map((row) =>
      db
        .prepare(
          `UPDATE consent_records SET withdrawn_at=?,withdrawn_source=?,updated_at=? WHERE id=? AND ${FRESH_MERGE}`,
        )
        .bind(
          rowValue(row.after, 'withdrawn_at'),
          rowValue(row.after, 'withdrawn_source'),
          input.stamp,
          row.id,
          ...freshMerge(input),
        ),
    ),
    ...fillPerson(db, input, book),
    ...invalidateMergedAccess(db, input),
    ...resolveMergeReviews(db, input, book),
    recomputeMergeMembership(db, input, input.survivorId),
    ...mergeReconciliation(db, input),
    ...finishMerge(db, input),
  ];
}
