import type { Page } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db, SqlValue } from './db';
import type { EventType } from './engagement';
import { STAFF_ADMIN_SCOPE, STAFF_PERSON_SCOPE } from './staff-scope';
export class InvalidCursor extends Error {
  constructor() {
    super('This page link is invalid. Start again from the People page.');
  }
}
const ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export function validatePersonCursor(cursor?: string): void {
  if (cursor && !ID.test(cursor)) throw new InvalidCursor();
}
export interface EngagementEvent {
  id: string;
  type: EventType;
  occurred_at: string;
  source: string;
  reference: string | null;
  details: string | null;
  recorded_by: string | null;
}
function historyCursor(cursor: string): { date: string; id: string } {
  try {
    if (cursor.length > 300 || !/^[\w-]+$/.test(cursor)) throw new InvalidCursor();
    const value: unknown = JSON.parse(atob(cursor.replaceAll('-', '+').replaceAll('_', '/')));
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== 'string' ||
      typeof value[1] !== 'string' ||
      !ID.test(value[1]) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value[0]) ||
      !Number.isFinite(Date.parse(value[0]))
    )
      throw new InvalidCursor();
    return { date: value[0], id: value[1] };
  } catch {
    throw new InvalidCursor();
  }
}
export async function staffHistory(
  db: Db,
  actorId: string,
  personId: string,
  cursor?: string,
): Promise<Page<EngagementEvent>> {
  const where = [
    'p.id=?',
    'p.deleted_at IS NULL',
    STAFF_PERSON_SCOPE,
    `(e.id NOT IN (SELECT id FROM donation_history) OR ${STAFF_ADMIN_SCOPE})`,
  ];
  const values: SqlValue[] = [personId, personId, personId, actorId, actorId];
  if (cursor) {
    const saved = historyCursor(cursor);
    where.push('(e.occurred_at < ? OR (e.occurred_at = ? AND e.id < ?))');
    values.push(saved.date, saved.date, saved.id);
  }
  const { results } = await db
    .prepare(
      `WITH RECURSIVE donation_history(id) AS (
    SELECT id FROM engagement_events WHERE person_id=? AND type='donated'
    UNION SELECT e.id FROM engagement_events e JOIN donation_history d ON e.reference=d.id WHERE e.person_id=? AND e.type='correction')
    SELECT e.id,e.type,e.occurred_at,e.source,e.reference,e.details, NULLIF(trim(coalesce(recorder.given_name,'') || ' ' || coalesce(recorder.family_name,'')),'') AS recorded_by
    FROM people p JOIN engagement_events e ON e.person_id=p.id
    LEFT JOIN people recorder ON recorder.id=json_extract(e.details,'$.actorId') AND recorder.deleted_at IS NULL
    WHERE ${where.join(' AND ')} ORDER BY e.occurred_at DESC,e.id DESC LIMIT 51`,
    )
    .bind(...values)
    .all<EngagementEvent>();
  const items = results.slice(0, 50);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      results.length > 50 && last
        ? btoa(JSON.stringify([last.occurred_at, last.id]))
            .replaceAll('+', '-')
            .replaceAll('/', '_')
            .replaceAll('=', '')
        : null,
  };
}
