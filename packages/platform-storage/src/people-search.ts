// Finding people for staff views: by email, text, membership status, ZIP code
// or region, a page at a time. Deleted people are never returned.

import type { MembershipStatus } from '@lasvegasfortransit/platform-core/membership';
import type { RegionId } from '@lasvegasfortransit/platform-core/regions';
import type { Db, SqlValue } from './db';
import { normalizeEmail } from './field-ownership';
import { PERSON_COLUMNS, type Person } from './person-service';

export interface PeopleQuery {
  text?: string;
  email?: string;
  membershipStatus?: MembershipStatus;
  zip?: string;
  regionId?: RegionId;
  limit: number;
  cursor?: string;
}

export async function findPeople(
  db: Db,
  query: PeopleQuery,
): Promise<{ people: Person[]; nextCursor: string | null }> {
  const { where, values } = peopleFilters(query);
  const limit = Math.max(1, Math.min(query.limit, 200));
  const { results } = await db
    .prepare(
      `SELECT ${PERSON_COLUMNS} FROM people WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`,
    )
    .bind(...values, limit + 1)
    .all<Person>();
  const page = results.slice(0, limit);
  return { people: page, nextCursor: results.length > limit ? (page.at(-1)?.id ?? null) : null };
}

/** Shared filters; staff callers add authorization before pagination. */
export function peopleFilters(query: Omit<PeopleQuery, 'limit'>, prefix = '') {
  const where = [`${prefix}deleted_at IS NULL`];
  const values: SqlValue[] = [];
  if (query.email) {
    where.push(`${prefix}email = ?`);
    values.push(normalizeEmail(query.email));
  }
  if (query.membershipStatus) {
    where.push(`${prefix}membership_status = ?`);
    values.push(query.membershipStatus);
  }
  if (query.zip) {
    where.push(`${prefix}zip = ?`);
    values.push(query.zip);
  }
  if (query.regionId) {
    where.push(`${prefix}region_id = ?`);
    values.push(query.regionId);
  }
  if (query.text) {
    where.push(
      `(coalesce(${prefix}given_name, '') || ' ' || coalesce(${prefix}family_name, '') || ' ' || coalesce(${prefix}email, '')) LIKE ? ESCAPE '\\'`,
    );
    values.push(
      `%${query.text.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`,
    );
  }
  if (query.cursor) {
    where.push(`${prefix}id > ?`);
    values.push(query.cursor);
  }
  return { where, values };
}
