import { nowIso, ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db } from './db';
import { newsletterErasureWrites } from './newsletter-erasure';
import {
  beginErasure,
  beginErasureCopies,
  eraseProfile,
  eraseHistory,
  eraseAccountProfiles,
} from './person-erasure';

/** Erase this person's profiles and saved copies; retain IDs for access removal. */
export async function deletePersonData(
  db: Db,
  id: string,
  options: { requesterId?: string } = {},
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await eraseCurrentPerson(db, id, options.requesterId ?? 'member');
      return;
    } catch (error) {
      if (attempt >= 2 || !(error instanceof Error) || !error.message.includes('valid_snapshot=1'))
        throw error;
    }
  }
}

async function eraseCurrentPerson(db: Db, id: string, requesterId: string): Promise<void> {
  const stamp = nowIso();
  const operationId = ulid();
  const newsletter = await newsletterErasureWrites(db, id, operationId, stamp);
  await db.batch([
    beginErasure(db, id, operationId, { stamp, requesterId }),
    ...newsletter,
    eraseProfile(db, operationId, stamp),
    beginErasureCopies(db, operationId),
    ...eraseHistory(db, operationId, stamp),
    ...eraseAccountProfiles(db, operationId, stamp),
    db.prepare('DELETE FROM person_erasure_copies WHERE operation_id=?').bind(operationId),
    db.prepare('DELETE FROM person_erasure_scope WHERE operation_id=?').bind(operationId),
  ]);
}
