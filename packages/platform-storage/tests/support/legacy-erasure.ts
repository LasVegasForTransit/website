import assert from 'node:assert/strict';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { newsletterErasureWrites } from '../../src/newsletter-erasure';
import {
  beginErasureCopies,
  eraseProfile,
  eraseHistory,
  eraseAccountProfiles,
} from '../../src/person-erasure';
import type { MemoryDb } from './db';

/** Reproduce pre-0041 erasure for one root in a fixture without merge history. */
export async function eraseLegacyFixturePerson(db: MemoryDb, personId: string): Promise<void> {
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM merges').get()?.n, 0);
  const operationId = ulid(),
    stamp = new Date().toISOString();
  const newsletter = await newsletterErasureWrites(db, personId, operationId, stamp);
  await db.batch([
    // The historical scope predates requested_by and reason. Keep its original
    // shape so the upgrade fixture never invokes a newer-schema deletion API.
    db
      .prepare(
        `INSERT INTO person_erasure_scope(operation_id,person_id,requested_at)
      SELECT ?,id,? FROM people WHERE id=? AND erased_at IS NULL`,
      )
      .bind(operationId, stamp, personId),
    ...newsletter,
    eraseProfile(db, operationId, stamp),
    beginErasureCopies(db, operationId),
    ...eraseHistory(db, operationId, stamp),
    ...eraseAccountProfiles(db, operationId, stamp),
    db.prepare('DELETE FROM person_erasure_copies WHERE operation_id=?').bind(operationId),
    db.prepare('DELETE FROM person_erasure_scope WHERE operation_id=?').bind(operationId),
  ]);
}
