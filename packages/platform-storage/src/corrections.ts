import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Actor, MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditDenied } from './audits';
import { PERSON_COLUMNS, type Person, type PersonFields } from './person-service';
import { correctionFields, changedCorrectionFields } from './correction-fields';
import { correctionWrites } from './correction-writes';
import { recordPersonView } from './record-views';
export interface CorrectionInput {
  fields: PersonFields;
  reason: string;
  operationId: string;
  expectedUpdatedAt?: string;
}
async function authorized(db: Db, actorId: string): Promise<boolean> {
  return Boolean(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actorId).first());
}
async function receipt(db: Db, actorId: string, operationId: string) {
  return db
    .prepare(
      `SELECT actor_id,kind,target_id,payload,result,applied_at FROM staff_operations WHERE operation_id=? AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(operationId, actorId)
    .first<{
      actor_id: string;
      kind: string;
      target_id: string;
      payload: string;
      result: string | null;
      applied_at: string | null;
    }>();
}
function receiptResult(
  saved: NonNullable<Awaited<ReturnType<typeof receipt>>>,
  input: { actorId: string; personId: string; payload: string },
): MutationResult<Person> {
  return saved.actor_id === input.actorId &&
    saved.target_id === input.personId &&
    saved.kind === 'person.correct' &&
    saved.payload === input.payload &&
    saved.result &&
    saved.applied_at
    ? { kind: 'ok', value: JSON.parse(saved.result) as Person }
    : { kind: 'conflict' };
}
export async function correctionView(
  db: Db,
  actor: Actor,
  personId: string,
): Promise<Person | null> {
  const person = await db
    .prepare(
      `SELECT ${PERSON_COLUMNS} FROM people p WHERE p.id=? AND p.deleted_at IS NULL AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(personId, actor.personId)
    .first<Person>();
  if (!person) return null;
  await recordPersonView(db, actor.personId, personId);
  return (await authorized(db, actor.personId)) ? person : null;
}
function validMetadata(input: CorrectionInput): boolean {
  return (
    typeof input.reason === 'string' &&
    Boolean(input.reason.trim()) &&
    input.reason.trim().length <= 2000 &&
    typeof input.operationId === 'string' &&
    Boolean(input.operationId.trim()) &&
    input.operationId.length <= 200
  );
}
export async function correctPerson(
  db: Db,
  actor: Actor,
  personId: string,
  input: CorrectionInput,
): Promise<MutationResult<Person>> {
  if (!(await authorized(db, actor.personId))) {
    await auditDenied(db, actor.personId, 'person.update');
    return { kind: 'forbidden' };
  }
  const entries = correctionFields(input.fields);
  if (!entries?.length || !validMetadata(input)) return { kind: 'invalid' };
  const reason = input.reason.trim();
  const payload = JSON.stringify({
    fields: Object.fromEntries(entries),
    reason,
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
  const person = await db
    .prepare(
      `SELECT ${PERSON_COLUMNS} FROM people p WHERE p.id=? AND p.deleted_at IS NULL AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(personId, actor.personId)
    .first<Person>();
  if (!person) return { kind: 'not_found' };
  const prior = await receipt(db, actor.personId, input.operationId);
  if (prior) return receiptResult(prior, { actorId: actor.personId, personId, payload });
  if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== person.updated_at)
    return { kind: 'conflict' };
  const changed = changedCorrectionFields(person, entries);
  if (!changed.length) return { kind: 'invalid' };
  try {
    await db.batch(
      correctionWrites(db, {
        actorId: actor.personId,
        person,
        payload,
        reason,
        operationId: input.operationId,
        entries: changed,
        stamp: new Date().toISOString(),
        correctionId: ulid(),
      }),
    );
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: people\.email/i.test(error.message))
      return { kind: 'conflict' };
    throw error;
  }
  const applied = await receipt(db, actor.personId, input.operationId);
  if (applied) return receiptResult(applied, { actorId: actor.personId, personId, payload });
  return { kind: (await authorized(db, actor.personId)) ? 'conflict' : 'forbidden' };
}
