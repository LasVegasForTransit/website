import { nowIso, ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db, SqlValue } from './db';
import { newsletterErasureWrites } from './newsletter-erasure';
import { PERSON_MERGE_TERMINAL } from './person-resolution';
import {
  beginErasure,
  beginErasureCopies,
  eraseProfile,
  eraseHistory,
  eraseAccountProfiles,
} from './person-erasure';

interface DeletionOptions {
  requesterId?: string;
  requireActiveSubject?: boolean;
  /** Internal trusted staff guard, applied to both ownership capture and the transaction seed. */
  selection?: { sql: string; values: SqlValue[] };
  operationId?: string;
  /** Staff confirmation returns a conflict instead of spending another invocation-sized batch. */
  retrySnapshotChanges?: boolean;
}

export class ErasureSnapshotChanged extends Error {
  constructor(cause: Error) {
    super('Account ownership changed before erasure', { cause });
    this.name = 'ErasureSnapshotChanged';
  }
}

/** Erase this person's profiles and saved copies; retain IDs for access removal. */
export async function deletePersonData(
  db: Db,
  id: string,
  options: DeletionOptions = {},
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await eraseCurrentPerson(db, id, options);
      return;
    } catch (error) {
      if (
        options.retrySnapshotChanges === false &&
        error instanceof Error &&
        error.message.includes('valid_snapshot=1')
      )
        throw new ErasureSnapshotChanged(error);
      if (attempt >= 2 || !(error instanceof Error) || !error.message.includes('valid_snapshot=1'))
        throw error;
    }
  }
}

async function eraseCurrentPerson(db: Db, id: string, options: DeletionOptions): Promise<void> {
  const stamp = nowIso();
  const operationId = options.operationId ?? ulid();
  const newsletter = await newsletterErasureWrites(
    db,
    options.selection ??
      (options.requireActiveSubject
        ? {
            sql: `SELECT id FROM people WHERE id=? AND deleted_at IS NULL AND erased_at IS NULL AND ${PERSON_MERGE_TERMINAL}`,
            values: [id],
          }
        : id),
    operationId,
    stamp,
  );
  await db.batch([
    beginErasure(db, id, operationId, {
      stamp,
      requesterId: options.requesterId ?? 'member',
      requireActiveSubject: options.requireActiveSubject,
      selection: options.selection,
    }),
    ...newsletter,
    eraseProfile(db, operationId, stamp),
    beginErasureCopies(db, operationId),
    ...eraseHistory(db, operationId, stamp),
    ...eraseAccountProfiles(db, operationId, stamp),
    db.prepare('DELETE FROM person_erasure_copies WHERE operation_id=?').bind(operationId),
    db.prepare('DELETE FROM person_erasure_scope WHERE operation_id=?').bind(operationId),
  ]);
}
