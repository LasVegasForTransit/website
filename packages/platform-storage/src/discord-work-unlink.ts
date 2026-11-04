import type { Db } from './db';
import { workScopeKey, type WorkScope } from './discord-work-types';

export async function unlinkWork(
  db: Db,
  input: { scope: WorkScope; id: string; generation: number },
  now: Date,
): Promise<boolean> {
  const { scope, id, generation } = input;
  const key = workScopeKey(scope),
    stamp = now.toISOString();
  const result = await db
    .prepare(
      `UPDATE discord_work_conversations SET state='unlinked',generation=generation+1,
    data_json=json_set(data_json,'$.state','unlinked','$.generation',generation+1),updated_at=?
    WHERE id=? AND scope_key=? AND generation=? AND state<>'unlinked'`,
    )
    .bind(stamp, id, key, generation)
    .run();
  if (result.meta.changes) {
    await db
      .prepare(
        "UPDATE discord_work_operations SET state='superseded',reason='unlinked',updated_at=? WHERE scope_key=? AND conversation_id=? AND state IN ('preview','queued','retryable')",
      )
      .bind(stamp, key, id)
      .run();
    return true;
  }
  const home = await db
    .prepare(
      `UPDATE discord_project_homes SET state='unlinked',generation=generation+1,
    data_json=json_set(data_json,'$.state','unlinked','$.generation',generation+1),updated_at=? WHERE id=? AND scope_key=? AND generation=? AND state<>'unlinked'`,
    )
    .bind(stamp, id, key, generation)
    .run();
  if (home.meta.changes) {
    await db
      .prepare(
        `UPDATE discord_work_conversations SET state='unlinked',generation=generation+1,data_json=json_set(data_json,'$.state','unlinked','$.generation',generation+1),updated_at=? WHERE home_id=? AND scope_key=? AND state<>'unlinked'`,
      )
      .bind(stamp, id, key)
      .run();
    await db
      .prepare(
        "UPDATE discord_work_operations SET state='superseded',reason='unlinked',updated_at=? WHERE scope_key=? AND home_id=? AND state IN ('preview','queued','retryable')",
      )
      .bind(stamp, key, id)
      .run();
  }
  return home.meta.changes > 0;
}
