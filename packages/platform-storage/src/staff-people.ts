import { can, PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Actor, Page } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import { PERSON_COLUMNS, type Person } from './person-service';
import { peopleFilters, type PeopleQuery } from './people-search';
import { auditDenied } from './audits';
import { recordPersonView } from './record-views';
import { loadActor } from './staff-roles';
import { STAFF_ADMIN_SCOPE, STAFF_PERSON_SCOPE } from './staff-scope';
import { staffHistory, validatePersonCursor, type EngagementEvent } from './staff-history';
import { ROSTER_NAME, readRosterCursor, rosterCursor } from './staff-roster-cursor';
export interface StaffPeopleQuery extends Omit<PeopleQuery, 'limit'> {
  committeeId?: string;
  limit?: number;
}
const COLUMNS = PERSON_COLUMNS.split(', ')
  .map((column) => `p.${column}`)
  .join(', ');
export async function searchStaffPeople(
  db: Db,
  actor: Actor,
  query: StaffPeopleQuery,
): Promise<Page<Person>> {
  const current = await loadActor(db, actor.personId);
  if (!current || !can(current, 'person.search')) {
    await auditDenied(db, actor.personId, 'person.search');
    throw new PermissionDenied('person.search');
  }
  const { cursor: savedCursor, ...filters } = query;
  const cursor = readRosterCursor(savedCursor);
  const { where, values } = peopleFilters(filters, 'p.');
  if (cursor) {
    where.push(`(${ROSTER_NAME},p.id) > (?,?)`);
    values.push(...cursor);
  }
  where.push(STAFF_PERSON_SCOPE);
  values.push(actor.personId);
  if (query.committeeId === 'unassigned') {
    where.push(
      'NOT EXISTS(SELECT 1 FROM committee_assignments a WHERE a.person_id=p.id AND a.ended_at IS NULL)',
    );
  } else if (query.committeeId) {
    where.push(
      'EXISTS(SELECT 1 FROM committee_assignments a WHERE a.person_id=p.id AND a.committee_id=? AND a.ended_at IS NULL)',
    );
    values.push(query.committeeId);
  }
  const limit = Number.isFinite(query.limit)
    ? Math.max(1, Math.min(200, Math.floor(query.limit ?? 25)))
    : 25;
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM people p WHERE ${where.join(' AND ')} ORDER BY ${ROSTER_NAME},p.id LIMIT ?`,
    )
    .bind(...values, limit + 1)
    .all<Person>();
  const items = results.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: results.length > limit && last ? rosterCursor(last) : null };
}
export interface ConsentRecord {
  id: string;
  scope: string;
  given_at: string;
  source: string;
  method: string;
  wording_version: string | null;
  withdrawn_at: string | null;
  withdrawn_source: string | null;
}
export interface LinkedIdentity {
  platform: string;
  external_id: string;
  external_email: string | null;
  linked_at: string;
  link_method: string;
}
export interface ProfileAssignment {
  id: string;
  committee_id: string;
  committee_name: string;
  role: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  account_update_state: string | null;
}
export interface ProfileFieldSource {
  field: string;
  source: string;
  confirmed_at: string;
}
export interface StaffPerson {
  person: Person;
  consents: ConsentRecord[];
  identities: LinkedIdentity[];
  assignments: ProfileAssignment[];
  fieldSources: ProfileFieldSource[];
  events: Page<EngagementEvent>;
}
async function survivorId(db: Db, personId: string): Promise<string | null> {
  const visited = new Set<string>();
  let id = personId;
  for (let depth = 0; depth < 10; depth++) {
    if (visited.has(id)) return null;
    visited.add(id);
    const merge = await db
      .prepare(
        'SELECT surviving_person_id FROM merges WHERE merged_person_id=? AND unmerged_at IS NULL ORDER BY merged_at DESC LIMIT 1',
      )
      .bind(id)
      .first<{ surviving_person_id: string }>();
    if (!merge) return id;
    id = merge.surviving_person_id;
  }
  return null;
}
async function profileRecords(db: Db, actorId: string, personId: string) {
  const scoped = `p.id=? AND p.deleted_at IS NULL AND ${STAFF_PERSON_SCOPE}`;
  const results = await Promise.all([
    db
      .prepare(
        `SELECT c.id,c.scope,c.given_at,c.source,c.method,c.wording_version,c.withdrawn_at,c.withdrawn_source FROM people p JOIN consent_records c ON c.person_id=p.id WHERE ${scoped} ORDER BY c.given_at DESC,c.id DESC`,
      )
      .bind(personId, actorId)
      .all<ConsentRecord>(),
    db
      .prepare(
        `SELECT i.platform,i.external_id,i.external_email,i.linked_at,i.link_method FROM people p JOIN identities i ON i.person_id=p.id WHERE ${scoped} AND (i.platform<>'givebutter' OR ${STAFF_ADMIN_SCOPE}) ORDER BY i.platform,i.id`,
      )
      .bind(personId, actorId, actorId)
      .all<LinkedIdentity>(),
    db
      .prepare(
        `SELECT a.id,a.committee_id,c.name AS committee_name,a.role,a.started_at,a.ended_at,a.end_reason,
        (SELECT o.state FROM integration_outbox o JOIN reconcile_generations g ON g.person_id=o.person_id AND g.target_id=o.target_id AND g.generation=o.generation WHERE o.person_id=p.id AND o.target_id=a.committee_id AND o.kind='committee_reconcile' ORDER BY o.created_at DESC,o.id DESC LIMIT 1) AS account_update_state
        FROM people p JOIN committee_assignments a ON a.person_id=p.id JOIN committees c ON c.id=a.committee_id WHERE ${scoped} ORDER BY a.started_at DESC,a.id DESC`,
      )
      .bind(personId, actorId)
      .all<ProfileAssignment>(),
    db
      .prepare(
        `SELECT f.field,f.source,f.confirmed_at FROM people p JOIN field_sources f ON f.person_id=p.id WHERE ${scoped} ORDER BY f.field`,
      )
      .bind(personId, actorId)
      .all<ProfileFieldSource>(),
  ]);
  return {
    consents: results[0].results,
    identities: results[1].results,
    assignments: results[2].results,
    fieldSources: results[3].results,
  };
}
export async function getStaffPerson(
  db: Db,
  actor: Actor,
  requestedId: string,
  input: { cursor?: string } = {},
): Promise<StaffPerson | null> {
  validatePersonCursor(requestedId);
  const personId = await survivorId(db, requestedId);
  const person = personId
    ? await db
        .prepare(
          `SELECT ${COLUMNS} FROM people p WHERE p.id=? AND p.deleted_at IS NULL AND ${STAFF_PERSON_SCOPE}`,
        )
        .bind(personId, actor.personId)
        .first<Person>()
    : null;
  if (!person) {
    await auditDenied(db, actor.personId, 'person.view');
    return null;
  }
  const [records, events] = await Promise.all([
    profileRecords(db, actor.personId, person.id),
    staffHistory(db, actor.personId, person.id, input.cursor),
  ]);
  const stillVisible = await db
    .prepare(
      `SELECT 1 AS visible FROM people p WHERE p.id=? AND p.deleted_at IS NULL AND ${STAFF_PERSON_SCOPE}`,
    )
    .bind(person.id, actor.personId)
    .first();
  if (!stillVisible) {
    await auditDenied(db, actor.personId, 'person.view');
    return null;
  }
  await recordPersonView(db, actor.personId, person.id);
  return { person, ...records, events };
}
