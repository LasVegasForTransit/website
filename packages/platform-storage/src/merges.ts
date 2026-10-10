import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Actor, MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db, Statement } from './db';
import { auditDenied } from './audits';
import {
  captureMergeState,
  stateRows,
  type MergeBookkeeping,
  type MergeRecord,
} from './merge-state';
import { mergeBookkeeping, mergeConflicts, currentMergeReview } from './merge-bookkeeping';
import { mergeWrites } from './merge-writes';
import { undoCompatible, unmergeWrites } from './unmerge-writes';
import {
  mergeAuthorized,
  mergeReceipt,
  mergeReplay,
  type MergeOperation,
} from './merge-operations';
export interface MergeInput {
  reviewId?: string;
  survivorId: string;
  mergedId: string;
  reason: string;
  operationId: string;
}
export interface UndoMergeInput {
  mergeId: string;
  reason: string;
  operationId: string;
}
function validMetadata(input: { reason: string; operationId: string }): boolean {
  return (
    typeof input.reason === 'string' &&
    Boolean(input.reason.trim()) &&
    input.reason.trim().length <= 2000 &&
    typeof input.operationId === 'string' &&
    Boolean(input.operationId.trim()) &&
    input.operationId.length <= 200
  );
}
async function runMerge(
  db: Db,
  input: MergeOperation,
  statements: Statement[],
): Promise<MutationResult<{ mergeId: string }>> {
  try {
    await db.batch(statements);
  } catch (error) {
    if (
      error instanceof Error &&
      /UNIQUE constraint failed|last_staff_administrator/i.test(error.message)
    )
      return { kind: 'conflict' };
    throw error;
  }
  const applied = await mergeReplay(db, input);
  return applied ?? { kind: (await mergeAuthorized(db, input.actorId)) ? 'conflict' : 'forbidden' };
}
export async function mergePeople(
  db: Db,
  actor: Actor,
  input: MergeInput,
): Promise<MutationResult<{ mergeId: string }>> {
  if (!(await mergeAuthorized(db, actor.personId))) {
    await auditDenied(db, actor.personId, 'person.merge');
    return { kind: 'forbidden' };
  }
  if (
    !validMetadata(input) ||
    !input.survivorId ||
    !input.mergedId ||
    input.survivorId === input.mergedId
  )
    return { kind: 'invalid' };
  const payload = JSON.stringify({
    survivorId: input.survivorId,
    mergedId: input.mergedId,
    reason: input.reason.trim(),
    reviewId: input.reviewId,
  });
  const stamp = new Date().toISOString();
  const operation: MergeOperation = {
    ...input,
    id: ulid(),
    actorId: actor.personId,
    kind: 'person.merge',
    reason: input.reason.trim(),
    payload,
    stamp,
  };
  const prior = await mergeReplay(db, operation);
  if (prior) return prior;
  const state = await captureMergeState(db, [input.survivorId, input.mergedId]);
  const people = stateRows(state, 'people');
  const survivor = people.find((row) => row.id === input.survivorId && row.deleted_at === null);
  const merged = people.find((row) => row.id === input.mergedId && row.deleted_at === null);
  if (!survivor || !merged) return { kind: 'not_found' };
  if (mergeConflicts(state, survivor, merged)) return { kind: 'conflict' };
  if (!currentMergeReview(state, input)) return { kind: 'conflict' };
  const book = mergeBookkeeping(state, survivor, merged, stamp);
  return runMerge(db, operation, [
    mergeReceipt(db, operation, state),
    ...mergeWrites(db, operation, book),
  ]);
}
export async function undoMerge(
  db: Db,
  actor: Actor,
  input: UndoMergeInput,
): Promise<MutationResult<{ mergeId: string }>> {
  if (!(await mergeAuthorized(db, actor.personId))) {
    await auditDenied(db, actor.personId, 'person.unmerge');
    return { kind: 'forbidden' };
  }
  if (!validMetadata(input) || !input.mergeId) return { kind: 'invalid' };
  const payload = JSON.stringify({ mergeId: input.mergeId, reason: input.reason.trim() });
  const prior = await mergeReplay(db, {
    actorId: actor.personId,
    operationId: input.operationId,
    kind: 'person.unmerge',
    payload,
  });
  if (prior) return prior;
  const record = await db
    .prepare('SELECT * FROM merges WHERE id=?')
    .bind(input.mergeId)
    .first<MergeRecord>();
  if (!record) return { kind: 'not_found' };
  if (record.unmerged_at || record.erased_at) return { kind: 'conflict' };
  const operation: MergeOperation = {
    id: record.id,
    actorId: actor.personId,
    operationId: input.operationId,
    kind: 'person.unmerge',
    reason: input.reason.trim(),
    payload,
    stamp: new Date().toISOString(),
    survivorId: record.surviving_person_id,
    mergedId: record.merged_person_id,
  };
  const book = JSON.parse(record.moved_rows) as MergeBookkeeping;
  const state = await captureMergeState(db, [operation.survivorId, operation.mergedId], book.rows);
  if (stateRows(state, 'merges').find((row) => row.id === record.id)?.unmerged_at !== null)
    return { kind: 'conflict' };
  if (!undoCompatible(state, record, book)) return { kind: 'conflict' };
  return runMerge(db, operation, [
    mergeReceipt(db, operation, state),
    ...unmergeWrites(db, operation, { record, book, state }),
  ]);
}
