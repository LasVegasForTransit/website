import type { Db } from '@lasvegasfortransit/platform-storage/db';

export async function savePayload(
  db: Db,
  id: string,
  userId: string,
  { original, payload }: { original: string; payload: Record<string, unknown> },
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE discord_work_operations SET payload_json=? WHERE id=? AND actor_discord_id=? AND state='preview' AND payload_json=?",
    )
    .bind(JSON.stringify(payload), id, userId, original)
    .run();
  return result.meta.changes > 0;
}
