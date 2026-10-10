import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { mergeAuthorized } from './merge-operations';
import { recordPersonView } from './record-views';
export interface MergeSummary {
  id: string;
  survivorId: string;
  mergedId: string;
  mergedAt: string;
  reason: string | null;
  actorName: string | null;
  undoneAt: string | null;
  erasedAt: string | null;
  survivorName: string;
  mergedName: string;
}
const COLUMNS = `m.id,m.surviving_person_id AS survivorId,m.merged_person_id AS mergedId,m.merged_at AS mergedAt,m.reason,
  nullif(trim(coalesce(actor.given_name,'')||' '||coalesce(actor.family_name,'')),'') AS actorName,m.unmerged_at AS undoneAt,m.erased_at AS erasedAt,
  coalesce(nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),''),p.email,'Member') AS survivorName,
  CASE WHEN original.deleted_at IS NULL OR original.deleted_at=m.merged_at THEN coalesce(nullif(trim(coalesce(original.given_name,'')||' '||coalesce(original.family_name,'')),''),original.email,'Previous entry') ELSE 'Previous entry' END AS mergedName`;
const JOINS = `merges m JOIN people p ON p.id=m.surviving_person_id AND p.deleted_at IS NULL
  JOIN people original ON original.id=m.merged_person_id LEFT JOIN people actor ON actor.id=m.merged_by`;
export async function mergeView(db: Db, actor: Actor, id: string): Promise<MergeSummary | null> {
  const row = await db
    .prepare(
      `SELECT ${COLUMNS} FROM ${JOINS} WHERE m.id=? AND m.operation_id IS NOT NULL AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(id, actor.personId)
    .first<MergeSummary>();
  if (!row) return null;
  await recordPersonView(db, actor.personId, row.survivorId);
  await recordPersonView(db, actor.personId, row.mergedId);
  return (await mergeAuthorized(db, actor.personId)) ? row : null;
}
export async function personMerges(
  db: Db,
  actor: Actor,
  personId: string,
): Promise<MergeSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM ${JOINS} WHERE m.surviving_person_id=? AND m.operation_id IS NOT NULL AND ${STAFF_ADMIN_SCOPE} ORDER BY m.merged_at DESC,m.id DESC LIMIT 20`,
    )
    .bind(personId, actor.personId)
    .all<MergeSummary>();
  return results;
}
