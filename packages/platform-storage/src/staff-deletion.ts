import type { Actor, MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { PERSON_COLUMNS, type Person } from './person-service';
import { PERSON_MERGE_TERMINAL } from './person-resolution';
import { deletePersonData, ErasureSnapshotChanged } from './person-deletion';
import { auditDenied } from './audits';

export interface StaffDeletionInput {
  expectedUpdatedAt: string;
  operationId: string;
}
export interface StaffDeletionView extends Person {
  has_google_account: number;
  has_combined_records: number;
}
function validInput(input: StaffDeletionInput): boolean {
  return (
    /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(input.operationId) &&
    Boolean(input.expectedUpdatedAt) &&
    input.expectedUpdatedAt.length <= 50 &&
    Number.isFinite(Date.parse(input.expectedUpdatedAt))
  );
}
const AFFECTED = `WITH RECURSIVE affected(id) AS (
  SELECT id FROM people WHERE id=?
  UNION SELECT CASE WHEN m.surviving_person_id=a.id THEN m.merged_person_id ELSE m.surviving_person_id END
    FROM merges m JOIN affected a ON a.id IN (m.surviving_person_id,m.merged_person_id)
    WHERE m.unmerged_at IS NULL AND m.erased_at IS NULL)`;
const ACTIVE_ADMINS = `SELECT a.person_id FROM staff_administrators a JOIN people administrator
  ON administrator.id=a.person_id WHERE administrator.deleted_at IS NULL AND administrator.membership_status='member'`;
const KEEP_ADMIN = `${AFFECTED} SELECT 1 WHERE
  NOT EXISTS(SELECT 1 FROM (${ACTIVE_ADMINS}) WHERE person_id IN (SELECT id FROM affected))
  OR EXISTS(SELECT 1 FROM (${ACTIVE_ADMINS}) WHERE person_id NOT IN (SELECT id FROM affected))`;
async function authorized(db: Db, actorId: string) {
  return Boolean(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actorId).first());
}
async function protectsLastAdmin(db: Db, personId: string) {
  return !(await db.prepare(KEEP_ADMIN).bind(personId).first());
}
async function rejectedDeletion(
  db: Db,
  actorId: string,
  personId: string,
): Promise<MutationResult<{ personId: string }>> {
  if (!(await authorized(db, actorId))) return { kind: 'forbidden' };
  return { kind: (await protectsLastAdmin(db, personId)) ? 'last_admin' : 'conflict' };
}
export async function staffDeletionView(
  db: Db,
  actor: Actor,
  personId: string,
): Promise<StaffDeletionView | null> {
  return await db
    .prepare(
      `SELECT ${PERSON_COLUMNS},
      EXISTS(SELECT 1 FROM identities WHERE person_id=p.id AND platform='google_workspace') AS has_google_account,
      EXISTS(SELECT 1 FROM merges WHERE p.id IN (surviving_person_id,merged_person_id)
        AND unmerged_at IS NULL AND erased_at IS NULL) AS has_combined_records FROM people p
    WHERE p.id=? AND p.deleted_at IS NULL AND p.erased_at IS NULL AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(personId, actor.personId)
    .first<StaffDeletionView>();
}
/** Erase only the confirmed record under current authority; cleanup uses the canonical member path. */
export async function deleteStaffPerson(
  db: Db,
  actor: Actor,
  personId: string,
  input: StaffDeletionInput,
): Promise<MutationResult<{ personId: string }>> {
  if (!(await authorized(db, actor.personId))) {
    await auditDenied(db, actor.personId, 'person.delete');
    return { kind: 'forbidden' };
  }
  if (!validInput(input)) return { kind: 'invalid' };
  const prior = await db
    .prepare('SELECT person_id,requested_by FROM person_deletion_log WHERE operation_id=?')
    .bind(input.operationId)
    .all<{ person_id: string; requested_by: string }>();
  if (prior.results.length)
    return prior.results.some(
      (row) => row.person_id === personId && row.requested_by === actor.personId,
    )
      ? { kind: 'ok', value: { personId } }
      : { kind: 'conflict' };
  const person = await staffDeletionView(db, actor, personId);
  if (!person) return { kind: 'not_found' };
  if (person.updated_at !== input.expectedUpdatedAt) return { kind: 'conflict' };
  if (await protectsLastAdmin(db, personId)) return { kind: 'last_admin' };
  const selection = {
    sql: `SELECT id FROM people WHERE id=? AND updated_at=? AND deleted_at IS NULL AND erased_at IS NULL
      AND ${PERSON_MERGE_TERMINAL} AND ${STAFF_ADMIN_SCOPE} AND EXISTS(${KEEP_ADMIN})
      AND NOT EXISTS(SELECT 1 FROM person_deletion_log WHERE operation_id=?)`,
    values: [personId, input.expectedUpdatedAt, actor.personId, personId, input.operationId],
  };
  try {
    await deletePersonData(db, personId, {
      requesterId: actor.personId,
      operationId: input.operationId,
      requireActiveSubject: true,
      selection,
      retrySnapshotChanges: false,
    });
  } catch (error) {
    if (error instanceof ErasureSnapshotChanged)
      return await rejectedDeletion(db, actor.personId, personId);
    if (error instanceof Error && error.message.includes('last_staff_administrator'))
      return { kind: 'last_admin' };
    throw error;
  }
  const completed = await db
    .prepare(
      'SELECT 1 FROM person_deletion_log WHERE person_id=? AND operation_id=? AND requested_by=?',
    )
    .bind(personId, input.operationId, actor.personId)
    .first();
  if (completed) return { kind: 'ok', value: { personId } };
  return await rejectedDeletion(db, actor.personId, personId);
}
