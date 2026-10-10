import type { Db } from './db';
/** p is the target; bind the current viewer ID. A claim grants no authority. */
export const WELCOME_SCOPE = `EXISTS (SELECT 1 FROM people viewer
 WHERE viewer.id=? AND viewer.deleted_at IS NULL AND viewer.membership_status='member'
 AND (EXISTS(SELECT 1 FROM staff_administrators WHERE person_id=viewer.id)
 OR EXISTS(SELECT 1 FROM committee_assignments a JOIN committees c ON c.id=a.committee_id,
 json_each(c.interest_ids) allowed_interest,
 json_each((SELECT json_extract(e.details,'$.interests') FROM engagement_events e
 WHERE e.person_id=p.id AND e.type='joined' AND NOT EXISTS (SELECT 1 FROM engagement_events correction
 WHERE correction.person_id=p.id AND correction.type='correction' AND correction.reference=e.id)
 ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1)) member_interest
 WHERE a.person_id=viewer.id AND a.role='lead' AND a.ended_at IS NULL
 AND allowed_interest.value=member_interest.value)))`;
export const MEMBER_SINCE = `(SELECT min(given_at) FROM consent_records
 WHERE person_id=p.id AND scope='newsletter' AND withdrawn_at IS NULL)`;
export const UNWELCOMED = `NOT EXISTS (SELECT 1 FROM engagement_events e WHERE e.person_id=p.id
 AND e.type='welcomed' AND julianday(e.occurred_at)>=julianday(${MEMBER_SINCE}))`;
export async function canWelcomePerson(
  db: Db,
  actorId: string,
  personId: string,
): Promise<boolean> {
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM people p WHERE p.id=? AND p.deleted_at IS NULL
    AND p.membership_status='member' AND ${WELCOME_SCOPE}`,
      )
      .bind(personId, actorId)
      .first(),
  );
}
