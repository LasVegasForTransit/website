import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db, Statement } from './db';
export async function auditedTaskCheckinChange(
  db: Db,
  actor: Pick<Actor, 'personId'>,
  change: {
    mutation: Statement;
    action: string;
    targetId: string;
    now: Date;
    after?: (auditId: string) => Statement[];
  },
): Promise<boolean> {
  const { mutation, action, targetId, now } = change;
  const id = ulid();
  await db.batch([
    mutation,
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,permission,target_id,occurred_at)
      SELECT ?,?,?,'staff_admin.manage',?,? WHERE changes()>0`,
      )
      .bind(id, actor.personId, action, targetId, now.toISOString()),
    ...(change.after?.(id) ?? []),
  ]);
  return Boolean(await db.prepare('SELECT 1 FROM staff_audits WHERE id=?').bind(id).first());
}
