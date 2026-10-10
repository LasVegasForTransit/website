import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import { WELCOME_SCOPE } from './welcome-scope';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
/** Only the claimant's permitted teams; this does not grant access to the member's full record. */
export async function welcomeCommittees(db: Db, actor: Actor, personId: string) {
  const { results } = await db
    .prepare(
      `SELECT c.id,c.name,c.accepting_members AS acceptingMembers,
      EXISTS(SELECT 1 FROM committee_assignments a WHERE a.person_id=p.id AND a.committee_id=c.id AND a.ended_at IS NULL) AS assigned
      FROM committees c,people p WHERE p.id=? AND p.deleted_at IS NULL AND p.membership_status='member'
      AND EXISTS(SELECT 1 FROM welcome_claims WHERE person_id=p.id AND actor_id=? AND expires_at>?)
      AND ${WELCOME_SCOPE} AND (${STAFF_ADMIN_SCOPE}
        OR EXISTS(SELECT 1 FROM committee_assignments a WHERE a.person_id=? AND a.committee_id=c.id AND a.role='lead' AND a.ended_at IS NULL))
      ORDER BY c.name`,
    )
    .bind(
      personId,
      actor.personId,
      new Date().toISOString(),
      actor.personId,
      actor.personId,
      actor.personId,
    )
    .all<{ id: string; name: string; acceptingMembers: number; assigned: number }>();
  return results.map((row) => ({
    ...row,
    acceptingMembers: Boolean(row.acceptingMembers),
    assigned: Boolean(row.assigned),
  }));
}
