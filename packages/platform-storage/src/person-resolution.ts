import type { Db } from './db';

/** Only live merge links participate; UNION terminates even a corrupt cycle. */
export const PERSON_MERGE_CHAIN = `WITH RECURSIVE chain(id) AS (
    SELECT id FROM people WHERE id=? AND erased_at IS NULL
    UNION
    SELECT m.surviving_person_id FROM chain
    JOIN people archived ON archived.id=chain.id AND archived.erased_at IS NULL
    JOIN merges m ON m.merged_person_id=chain.id AND m.unmerged_at IS NULL AND m.erased_at IS NULL
      AND archived.deleted_at=m.merged_at
  )`;
export const PERSON_MERGE_TERMINAL = `NOT EXISTS(SELECT 1 FROM merges active_merge
  WHERE active_merge.merged_person_id=people.id AND active_merge.unmerged_at IS NULL
    AND active_merge.erased_at IS NULL)`;

/** Resolve only live merge links; erased and ordinarily deleted records never redirect. */
export async function resolvePersonId(db: Db, id: string): Promise<string | null> {
  const row = await db
    .prepare(
      `${PERSON_MERGE_CHAIN} SELECT id FROM people WHERE id IN (SELECT id FROM chain)
    AND deleted_at IS NULL AND erased_at IS NULL AND ${PERSON_MERGE_TERMINAL} LIMIT 1`,
    )
    .bind(id)
    .first<{ id: string }>();
  return row?.id ?? null;
}
