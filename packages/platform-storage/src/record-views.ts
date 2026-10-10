import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db } from './db';
/** Profile read receipts deliberately contain no names, contact data or search terms. */
export async function recordPersonView(db: Db, actorId: string, personId: string): Promise<void> {
  await db
    .prepare('INSERT INTO person_views (id,actor_id,person_id,occurred_at) VALUES (?,?,?,?)')
    .bind(ulid(), actorId, personId, new Date().toISOString())
    .run();
}
