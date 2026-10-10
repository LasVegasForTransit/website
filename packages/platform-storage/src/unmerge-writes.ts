import type { Db, Statement } from './db';
import {
  RELATED_TABLES,
  rowValue,
  stateRows,
  type MergeBookkeeping,
  type RelatedTable,
  type MergeRecord,
  type MergeRow,
  type MergeSnapshot,
} from './merge-state';
import {
  FRESH_MERGE,
  freshMerge,
  type MergeOperation,
  finishMerge,
  invalidateMergedAccess,
  recomputeMergeMembership,
  mergeReconciliation,
} from './merge-operations';
import { ownershipWrites, sourceRestore } from './merge-writes';
function equalRows(a: MergeRow | null, b: MergeRow | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
const STABLE_FIELDS: Partial<Record<RelatedTable, readonly string[]>> = {
  identities: ['platform', 'external_id'],
  committee_assignments: ['committee_id', 'started_at', 'assigned_by'],
  consent_records: ['scope', 'given_at', 'source', 'method', 'wording_version', 'created_at'],
  workspace_link_operations: ['workspace_subject', 'created_at'],
};
function compatibleMovements(
  state: MergeSnapshot[],
  book: MergeBookkeeping,
  survivorId: string,
): boolean {
  for (const movement of book.rows) {
    const row = stateRows(state, movement.table).find(
      (row) => row[RELATED_TABLES[movement.table].key] === movement.key,
    );
    if (!row) {
      if (movement.table === 'identities') continue;
      return false;
    }
    if (row.person_id !== survivorId) return false;
    if (
      (STABLE_FIELDS[movement.table] ?? []).some((field) => row[field] !== movement.before[field])
    )
      return false;
  }
  return true;
}
export function undoCompatible(
  state: MergeSnapshot[],
  record: MergeRecord,
  book: MergeBookkeeping,
): boolean {
  const people = stateRows(state, 'people');
  const survivor = people.find((row) => row.id === record.surviving_person_id);
  const merged = people.find((row) => row.id === record.merged_person_id);
  if (
    survivor?.deleted_at !== null ||
    merged?.erased_at !== null ||
    !equalRows(merged, { ...book.archivedAfter, erased_at: null })
  )
    return false;
  for (const field of book.fields) {
    if (survivor[field.field] !== field.after) return false;
    if (
      field.afterSource &&
      !equalRows(
        stateRows(state, 'field_sources').find(
          (row) => row.person_id === survivor.id && row.field === field.field,
        ) ?? null,
        field.afterSource,
      )
    )
      return false;
  }
  if (!compatibleMovements(state, book, String(survivor.id))) return false;
  if (
    book.copiedAdmin &&
    !equalRows(
      stateRows(state, 'staff_administrators').find((row) => row.person_id === survivor.id) ?? null,
      book.copiedAdmin,
    )
  )
    return false;
  return true;
}
function restoreConsents(
  db: Db,
  input: MergeOperation,
  book: MergeBookkeeping,
  state: MergeSnapshot[],
): Statement[] {
  const laterIntents = stateRows(state, 'consent_withdrawals')
    .filter(
      (row) => row.person_id === input.survivorId && !book.withdrawalIds.includes(String(row.id)),
    )
    .sort((a, b) => Date.parse(String(b.withdrawn_at)) - Date.parse(String(a.withdrawn_at)));
  const originals = new Map(book.suppressed.map((row) => [row.id, row]));
  const moved = new Set(
    book.rows.filter((row) => row.table === 'consent_records').map((row) => row.key),
  );
  return stateRows(state, 'consent_records').flatMap((row) => {
    const saved = originals.get(String(row.id));
    const original =
      saved &&
      row.withdrawn_at === saved.after.withdrawn_at &&
      row.withdrawn_source === saved.after.withdrawn_source &&
      row.updated_at === saved.after.updated_at
        ? saved.before
        : row;
    const later = laterIntents.find(
      (intent) =>
        intent.scope === row.scope &&
        Date.parse(String(original.given_at)) <= Date.parse(String(intent.withdrawn_at)),
    );
    const withdrawnAt = later?.withdrawn_at ?? rowValue(original, 'withdrawn_at');
    const source = later?.source ?? rowValue(original, 'withdrawn_source');
    if (!saved && !later && !moved.has(String(row.id))) return [];
    return [
      db
        .prepare(
          `UPDATE consent_records SET withdrawn_at=?,withdrawn_source=?,updated_at=? WHERE id=? AND ${FRESH_MERGE}`,
        )
        .bind(withdrawnAt, source, input.stamp, rowValue(row, 'id'), ...freshMerge(input)),
    ];
  });
}
function restoreReviews(
  db: Db,
  input: MergeOperation,
  book: MergeBookkeeping,
  record: MergeRecord,
): Statement[] {
  return book.reviews
    .filter(
      (row) =>
        row.candidate_person_id === input.mergedId || row.existing_person_id === input.mergedId,
    )
    .map((row) =>
      db
        .prepare(
          `UPDATE review_queue SET resolved_at=?,resolved_by=?,resolution=?,updated_at=? WHERE id=? AND resolved_at=? AND resolved_by=? AND resolution='merged' AND ${FRESH_MERGE}`,
        )
        .bind(
          rowValue(row, 'resolved_at'),
          rowValue(row, 'resolved_by'),
          rowValue(row, 'resolution'),
          input.stamp,
          rowValue(row, 'id'),
          record.merged_at,
          record.merged_by,
          ...freshMerge(input),
        ),
    );
}
export function unmergeWrites(
  db: Db,
  input: MergeOperation,
  context: { record: MergeRecord; book: MergeBookkeeping; state: MergeSnapshot[] },
): Statement[] {
  const { record, book, state } = context;
  return [
    ...(book.fields.length
      ? [
          db
            .prepare(
              `UPDATE people SET ${book.fields.map((field) => `${field.field}=?`).join(',')},updated_at=? WHERE id=? AND ${FRESH_MERGE}`,
            )
            .bind(
              ...book.fields.map((field) => field.before),
              input.stamp,
              input.survivorId,
              ...freshMerge(input),
            ),
        ]
      : []),
    db
      .prepare(`UPDATE people SET deleted_at=NULL,updated_at=? WHERE id=? AND ${FRESH_MERGE}`)
      .bind(input.stamp, input.mergedId, ...freshMerge(input)),
    ...ownershipWrites(db, input, book),
    ...book.fields
      .filter((field) => field.afterSource)
      .map((field) => sourceRestore(db, input, field.field, field.beforeSource)),
    ...(book.copiedAdmin
      ? [
          db
            .prepare(`DELETE FROM staff_administrators WHERE person_id=? AND ${FRESH_MERGE}`)
            .bind(input.survivorId, ...freshMerge(input)),
        ]
      : []),
    ...restoreConsents(db, input, book, state),
    ...restoreReviews(db, input, book, record),
    ...invalidateMergedAccess(db, input),
    recomputeMergeMembership(db, input, input.survivorId),
    recomputeMergeMembership(db, input, input.mergedId),
    db
      .prepare(
        `UPDATE merges SET unmerged_at=?,unmerged_by=?,updated_at=? WHERE id=? AND ${FRESH_MERGE}`,
      )
      .bind(input.stamp, input.actorId, input.stamp, input.id, ...freshMerge(input)),
    ...mergeReconciliation(db, input),
    ...finishMerge(db, input),
  ];
}
