import type { Db } from './db';
export async function taskProviderCoolingDown(
  db: Db,
  sourceId: string,
  now: Date,
): Promise<boolean> {
  return Boolean(
    await db
      .prepare('SELECT 1 FROM task_checkin_provider_backoffs WHERE source_id=? AND not_before>?')
      .bind(sourceId, now.toISOString())
      .first(),
  );
}
export async function deferTaskProvider(
  db: Db,
  sourceId: string,
  retryAfterMs: number,
  now: Date,
): Promise<void> {
  const until = new Date(
    now.getTime() + Math.max(1000, Math.min(86_400_000, retryAfterMs)),
  ).toISOString();
  await db
    .prepare(
      `INSERT INTO task_checkin_provider_backoffs(source_id,not_before,updated_at)
    SELECT id,?,? FROM task_checkin_sources WHERE id=?
    ON CONFLICT(source_id) DO UPDATE SET not_before=excluded.not_before,updated_at=excluded.updated_at
    WHERE excluded.not_before>task_checkin_provider_backoffs.not_before`,
    )
    .bind(until, now.toISOString(), sourceId)
    .run();
}
