import type { Actor, MutationResult, Page } from '@lasvegasfortransit/platform-core/staff-types';
import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Db, SqlValue } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditDenied } from './audits';
import { InvalidCursor } from './staff-history';
import { getStaffPerson, type StaffPerson } from './staff-people';
import { keepSeparateWrites } from './review-writes';
export interface ReviewRow {
  id: string;
  candidateId: string;
  existingId: string;
  reason: string;
  details: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  candidateName: string;
  existingName: string;
}
export interface ReviewItem extends ReviewRow {
  candidate: StaffPerson;
  existing: StaffPerson;
}
const COLUMNS = `q.id,q.candidate_person_id AS candidateId,q.existing_person_id AS existingId,q.reason,q.details,q.created_at AS createdAt,
  q.resolved_at AS resolvedAt,q.resolved_by AS resolvedBy,q.resolution,
  coalesce(nullif(trim(coalesce(a.given_name,'') || ' ' || coalesce(a.family_name,'')),''),a.email,'Name not recorded') AS candidateName,
  coalesce(nullif(trim(coalesce(b.given_name,'') || ' ' || coalesce(b.family_name,'')),''),b.email,'Name not recorded') AS existingName`;
const JOINS = `review_queue q JOIN people a ON a.id=q.candidate_person_id AND a.deleted_at IS NULL JOIN people b ON b.id=q.existing_person_id AND b.deleted_at IS NULL`;
async function admin(db: Db, actorId: string): Promise<boolean> {
  return Boolean(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actorId).first());
}
function cursorValue(cursor: string): [string, string] {
  try {
    if (cursor.length > 350 || !/^[\w-]+$/.test(cursor)) throw new InvalidCursor();
    const value: unknown = JSON.parse(atob(cursor.replaceAll('-', '+').replaceAll('_', '/')));
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== 'string' ||
      typeof value[1] !== 'string' ||
      !/^[\w-]{1,100}$/.test(value[1]) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(value[0]) ||
      !Number.isFinite(Date.parse(value[0]))
    )
      throw new InvalidCursor();
    return [value[0], value[1]];
  } catch {
    throw new InvalidCursor();
  }
}
export async function listReviews(
  db: Db,
  actor: Actor,
  query: { cursor?: string; limit?: number },
): Promise<Page<ReviewRow>> {
  if (!(await admin(db, actor.personId))) {
    await auditDenied(db, actor.personId, 'review_queue.resolve');
    throw new PermissionDenied('review_queue.resolve');
  }
  const where = ['q.resolved_at IS NULL', STAFF_ADMIN_SCOPE];
  const values: SqlValue[] = [actor.personId];
  if (query.cursor) {
    const [date, id] = cursorValue(query.cursor);
    where.push('(q.created_at>? OR (q.created_at=? AND q.id>?))');
    values.push(date, date, id);
  }
  const limit = Number.isFinite(query.limit)
    ? Math.max(1, Math.min(100, Math.floor(query.limit ?? 25)))
    : 25;
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM ${JOINS} WHERE ${where.join(' AND ')} ORDER BY q.created_at,q.id LIMIT ?`,
    )
    .bind(...values, limit + 1)
    .all<ReviewRow>();
  const items = results.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      results.length > limit && last
        ? btoa(JSON.stringify([last.createdAt, last.id]))
            .replaceAll('+', '-')
            .replaceAll('/', '_')
            .replaceAll('=', '')
        : null,
  };
}
export async function reviewItem(db: Db, actor: Actor, id: string): Promise<ReviewItem | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM ${JOINS} WHERE q.id=? AND ${STAFF_ADMIN_SCOPE}`)
    .bind(id, actor.personId)
    .first<ReviewRow>();
  if (!row) return null;
  const [candidate, existing] = await Promise.all([
    getStaffPerson(db, actor, row.candidateId),
    getStaffPerson(db, actor, row.existingId),
  ]);
  return candidate &&
    existing &&
    candidate.person.id !== existing.person.id &&
    (await admin(db, actor.personId))
    ? { ...row, candidate, existing }
    : null;
}
export async function keepSeparate(
  db: Db,
  actor: Actor,
  reviewId: string,
  input: { operationId: string; note: string },
): Promise<MutationResult<{ reviewId: string }>> {
  if (!(await admin(db, actor.personId))) {
    await auditDenied(db, actor.personId, 'review_queue.resolve');
    return { kind: 'forbidden' };
  }
  if (!input.operationId.trim() || input.operationId.length > 200 || input.note.length > 2000)
    return { kind: 'invalid' };
  const payload = JSON.stringify({ note: input.note.trim() });
  const prior = await db
    .prepare(
      `SELECT actor_id,kind,target_id,payload,applied_at FROM staff_operations WHERE operation_id=? AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(input.operationId, actor.personId)
    .first<{
      actor_id: string;
      kind: string;
      target_id: string;
      payload: string;
      applied_at: string | null;
    }>();
  if (prior)
    return prior.actor_id === actor.personId &&
      prior.kind === 'review.keep_separate' &&
      prior.target_id === reviewId &&
      prior.payload === payload &&
      prior.applied_at
      ? { kind: 'ok', value: { reviewId } }
      : { kind: 'conflict' };
  const row = await db
    .prepare(
      `SELECT ${COLUMNS} FROM ${JOINS} WHERE q.id=? AND q.resolved_at IS NULL AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(reviewId, actor.personId)
    .first<ReviewRow>();
  if (!row) return { kind: 'conflict' };
  await db.batch(
    keepSeparateWrites(db, {
      id: reviewId,
      actorId: actor.personId,
      operationId: input.operationId,
      payload,
      stamp: new Date().toISOString(),
      candidateId: row.candidateId,
      existingId: row.existingId,
      note: input.note.trim(),
    }),
  );
  const applied = await db
    .prepare(
      `SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=? AND kind='review.keep_separate' AND payload=? AND applied_at IS NOT NULL AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(input.operationId, actor.personId, reviewId, payload, actor.personId)
    .first();
  return applied ? { kind: 'ok', value: { reviewId } } : { kind: 'conflict' };
}
