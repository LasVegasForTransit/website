import type { Actor, MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import {
  validatePaper,
  type PaperInput,
  type PaperErrors,
} from '@lasvegasfortransit/platform-core/paper';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from './db';
import { auditDenied } from './audits';
import { paperAllowed, planPaperRows } from './paper-plan';
import { paperWrites } from './paper-writes';
export interface PaperResult {
  personIds: string[];
  reviewIds: string[];
  withdrawalHeldIds?: string[];
}
export type PaperOutcome =
  | Exclude<
      MutationResult<PaperResult>,
      { kind: 'invalid' | 'conflict' | 'not_found' | 'forbidden' | 'last_admin' }
    >
  | { kind: 'invalid'; errors: PaperErrors }
  | { kind: 'conflict' | 'forbidden' };
async function savedBatch(
  db: Db,
  input: { batchId: string; actorId: string; hash: string },
): Promise<PaperOutcome | null> {
  const row = await db
    .prepare('SELECT actor_id,payload_hash,result,applied_at FROM paper_batches WHERE id=?')
    .bind(input.batchId)
    .first<{
      actor_id: string;
      payload_hash: string;
      result: string | null;
      applied_at: string | null;
    }>();
  if (!row) return null;
  return row.actor_id === input.actorId &&
    row.payload_hash === input.hash &&
    row.result &&
    row.applied_at
    ? { kind: 'ok', value: JSON.parse(row.result) as PaperResult }
    : { kind: 'conflict' };
}
export async function importPaperBatch(
  db: Db,
  actor: Actor,
  input: PaperInput,
): Promise<PaperOutcome> {
  if (!(await paperAllowed(db, actor.personId))) {
    await auditDenied(db, actor.personId, 'attendance.record');
    return { kind: 'forbidden' };
  }
  const errors = validatePaper(input);
  if (Object.keys(errors).length) return { kind: 'invalid', errors };
  const hash = await digestToken(JSON.stringify(input));
  const key = { batchId: input.batchId, actorId: actor.personId, hash };
  const prior = await savedBatch(db, key);
  if (prior) return prior;
  const records = await planPaperRows(db, input);
  try {
    await db.batch(
      paperWrites(db, {
        input,
        records,
        actorId: actor.personId,
        hash,
        stamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed: people.email'))
      return { kind: 'conflict' };
    throw error;
  }
  if (!(await paperAllowed(db, actor.personId))) return { kind: 'forbidden' };
  return (await savedBatch(db, key)) ?? { kind: 'conflict' };
}
export async function paperBatchSummary(
  db: Db,
  actor: Actor,
  batchId: string,
): Promise<{ rows: number; reviews: number; heldSignups: number } | null> {
  if (!(await paperAllowed(db, actor.personId))) return null;
  const row = await db
    .prepare(
      'SELECT result FROM paper_batches WHERE id=? AND actor_id=? AND applied_at IS NOT NULL',
    )
    .bind(batchId, actor.personId)
    .first<{ result: string }>();
  if (!row) return null;
  const result = JSON.parse(row.result) as PaperResult;
  return {
    rows: result.personIds.length,
    reviews: result.reviewIds.length,
    heldSignups: (result.withdrawalHeldIds ?? []).length,
  };
}
