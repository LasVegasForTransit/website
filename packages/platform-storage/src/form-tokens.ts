import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import { digestToken, randomToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from './db';
const ELIGIBLE = `EXISTS (SELECT 1 FROM people p WHERE p.id=? AND p.deleted_at IS NULL AND p.membership_status='member'
  AND (EXISTS(SELECT 1 FROM staff_administrators WHERE person_id=p.id) OR
       EXISTS(SELECT 1 FROM committee_assignments WHERE person_id=p.id AND role='lead' AND ended_at IS NULL)))`;
export async function issueFormToken(db: Db, actor: Actor, action: string, now: Date = new Date()) {
  const token = randomToken();
  await db
    .prepare(
      `INSERT INTO staff_form_tokens(token_hash,actor_id,action,expires_at,created_at)
    SELECT ?,?,?,?,? WHERE ${ELIGIBLE}`,
    )
    .bind(
      await digestToken(token),
      actor.personId,
      action,
      new Date(now.getTime() + 30 * 60_000).toISOString(),
      now.toISOString(),
      actor.personId,
    )
    .run();
  return token;
}
export async function consumeFormToken(
  db: Db,
  actor: Actor,
  input: { action: string; token: string; now?: Date },
): Promise<boolean> {
  if (!/^[\w-]{43}$/.test(input.token)) return false;
  const row = await db
    .prepare(
      `DELETE FROM staff_form_tokens WHERE token_hash=? AND actor_id=? AND action=? AND expires_at>?
    AND ${ELIGIBLE} RETURNING token_hash`,
    )
    .bind(
      await digestToken(input.token),
      actor.personId,
      input.action,
      (input.now ?? new Date()).toISOString(),
      actor.personId,
    )
    .first();
  return Boolean(row);
}
