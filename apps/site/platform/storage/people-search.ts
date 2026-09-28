// Finding people for staff views: by email, text, membership status, ZIP code
// or region, a page at a time. Deleted people are never returned.

import type { MembershipStatus } from '../core/membership';
import type { RegionId } from '../core/regions';
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
  const where = ['deleted_at IS NULL'];
  const values: SqlValue[] = [];
  if (query.email) {
    where.push('email = ?');
    values.push(normalizeEmail(query.email));
  }
  if (query.membershipStatus) {
    where.push('membership_status = ?');
    values.push(query.membershipStatus);
  }
  if (query.zip) {
    where.push('zip = ?');
    values.push(query.zip);
  }
  if (query.regionId) {
    where.push('region_id = ?');
    values.push(query.regionId);
  }
  if (query.text) {
    where.push(
      "(given_name || ' ' || coalesce(family_name, '') || ' ' || coalesce(email, '')) LIKE ?",
    );
    values.push(`%${query.text}%`);
  }
  if (query.cursor) {
    where.push('id > ?');
    values.push(query.cursor);
  }
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
