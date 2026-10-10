import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Permission } from '@lasvegasfortransit/platform-core/permissions';
import type { Db } from './db';
/** The denial API deliberately accepts no target or submitted personal data. */
export async function auditDenied(db: Db, actorId: string, permission: Permission): Promise<void> {
  await db
    .prepare(
      'INSERT INTO staff_audits (id,actor_id,action,permission,occurred_at) VALUES (?,?,?,?,?)',
    )
    .bind(ulid(), actorId, 'permission.denied', permission, new Date().toISOString())
    .run();
}
export { recordPersonView as auditPersonView } from './record-views';
