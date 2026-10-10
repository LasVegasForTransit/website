import { nowIso, ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db } from './db';
import {
  beginErasure,
  beginErasureCopies,
  eraseProfile,
  eraseHistory,
  eraseAccountProfiles,
} from './person-erasure';

/** Erase this person's profiles and saved copies; retain IDs for access removal. */
export async function deletePersonData(db: Db, id: string): Promise<void> {
  const stamp = nowIso();
  const operationId = ulid();
  await db.batch([
    beginErasure(db, id, operationId, stamp),
    eraseProfile(db, operationId, stamp),
    beginErasureCopies(db, operationId),
    ...eraseHistory(db, operationId, stamp),
    ...eraseAccountProfiles(db, operationId, stamp),
    db.prepare('DELETE FROM person_erasure_copies WHERE operation_id=?').bind(operationId),
    db.prepare('DELETE FROM person_erasure_scope WHERE operation_id=?').bind(operationId),
  ]);
}
