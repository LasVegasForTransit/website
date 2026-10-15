import { INTERESTS } from '@lasvegasfortransit/platform-core/join-form';
import type { Page } from '@lasvegasfortransit/platform-core/staff-types';
import type { WelcomeQueueRow } from '@lasvegasfortransit/platform-core/welcome';
import type { Db, SqlValue } from './db';
import { InvalidCursor, validatePersonCursor } from './staff-history';
import { MEMBER_SINCE, UNWELCOMED, WELCOME_SCOPE } from './welcome-scope';
export const DAY = 86_400_000;
function decode(cursor: string): [string, string] {
  try {
    if (cursor.length > 300 || !/^[\w-]+$/.test(cursor)) throw new InvalidCursor();
    const parsed: unknown = JSON.parse(atob(cursor.replaceAll('-', '+').replaceAll('_', '/')));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string' ||
      !Number.isFinite(Date.parse(parsed[0]))
    )
      throw new InvalidCursor();
    validatePersonCursor(parsed[1]);
    return [parsed[0], parsed[1]];
  } catch {
    throw new InvalidCursor();
  }
}
interface QueueRow extends Omit<WelcomeQueueRow, 'overdue' | 'interests' | 'waitingDays'> {
  overdue: number;
  interests: string | null;
}
export async function welcomeQueue(
  db: Db,
  actorId: string,
  input: { now: Date; cursor?: string; limit?: number; personId?: string },
): Promise<Page<WelcomeQueueRow>> {
  const { now } = input;
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 25)));
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(limit)) throw new InvalidCursor();
  const where = ['julianday(joinedAt)>=julianday(?)', 'julianday(joinedAt)<=julianday(?)'];
  const values: SqlValue[] = [
    new Date(now.getTime() - 7 * DAY).toISOString(),
    now.toISOString(),
    actorId,
    new Date(now.getTime() - 60 * DAY).toISOString(),
    now.toISOString(),
  ];
  if (input.personId) {
    where.splice(
      0,
      where.length,
      '((julianday(joinedAt)>=julianday(?) AND julianday(joinedAt)<=julianday(?)) OR (claimedBy=? AND claimExpiresAt>?))',
      'personId=?',
    );
    values.push(actorId, now.toISOString(), input.personId);
  }
  if (input.cursor) {
    const [date, id] = decode(input.cursor);
    where.push('(joinedAt>? OR (joinedAt=? AND personId>?))');
    values.push(date, date, id);
  }
  const { results } = await db
    .prepare(
      `WITH queue AS (
    SELECT p.id AS personId,p.given_name AS givenName,p.family_name AS familyName,${MEMBER_SINCE} AS joinedAt,
    (SELECT source FROM consent_records WHERE person_id=p.id AND scope='newsletter' AND withdrawn_at IS NULL ORDER BY given_at,id LIMIT 1) AS source,
    (SELECT CASE WHEN json_type(e.details,'$.interests')='array' THEN json_extract(e.details,'$.interests') ELSE '[]' END FROM engagement_events e WHERE e.person_id=p.id AND e.type='joined' AND NOT EXISTS(SELECT 1 FROM engagement_events correction WHERE correction.person_id=p.id AND correction.type='correction' AND correction.reference=e.id) ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1) AS interests,
    c.actor_id AS claimedBy,NULLIF(trim(coalesce(claimant.given_name,'') || ' ' || coalesce(claimant.family_name,'')),'') AS claimedByName,c.expires_at AS claimExpiresAt,
    julianday(${MEMBER_SINCE})<julianday(?) AS overdue FROM people p
    LEFT JOIN welcome_claims c ON c.person_id=p.id AND c.expires_at>?
    LEFT JOIN people claimant ON claimant.id=c.actor_id AND claimant.deleted_at IS NULL
    WHERE p.deleted_at IS NULL AND p.membership_status='member' AND ${WELCOME_SCOPE} AND ${UNWELCOMED})
    SELECT * FROM queue WHERE ${where.join(' AND ')} ORDER BY joinedAt,personId LIMIT ?`,
    )
    .bind(...values, limit + 1)
    .all<QueueRow>();
  const items = results.slice(0, limit).map((row) => {
    const interests: unknown = JSON.parse(row.interests ?? '[]');
    return {
      ...row,
      overdue: Boolean(row.overdue),
      waitingDays: Math.max(0, Math.floor((now.getTime() - Date.parse(row.joinedAt)) / DAY)),
      interests: Array.isArray(interests)
        ? INTERESTS.filter((interest) => interests.includes(interest))
        : [],
    };
  });
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      results.length > limit && last
        ? btoa(JSON.stringify([last.joinedAt, last.personId]))
            .replaceAll('+', '-')
            .replaceAll('/', '_')
            .replace(/=+$/, '')
        : null,
  };
}
