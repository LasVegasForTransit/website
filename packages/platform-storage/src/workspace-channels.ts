import type { Db } from './db';
const EVENTS = ['add', 'update', 'delete', 'undelete'];
function expires(value: unknown, now: Date) {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value &&
    Date.parse(value) > now.getTime() &&
    Date.parse(value) <= now.getTime() + 86400000
  );
}
export async function registerWorkspaceChannel(
  db: Db,
  customerId: string,
  input: Record<string, unknown>,
  now: Date,
) {
  if (
    typeof input.id !== 'string' ||
    !/^[\w.-]{1,128}$/.test(input.id) ||
    !EVENTS.includes(String(input.event)) ||
    typeof input.tokenHash !== 'string' ||
    !/^[\w-]{43}$/.test(input.tokenHash) ||
    !expires(input.expiresAt, now)
  )
    return null;
  const result = await db
    .prepare(
      `INSERT INTO workspace_directory_channels(id,customer_id,event,token_hash,created_at,expires_at)
    SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM workspace_directory_channels WHERE customer_id=? AND event=?
      AND ((resource_id IS NOT NULL AND expires_at>?) OR (resource_id IS NULL AND created_at>?))) ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      input.id,
      customerId,
      String(input.event),
      input.tokenHash,
      now.toISOString(),
      String(input.expiresAt),
      customerId,
      String(input.event),
      new Date(now.getTime() + 300000).toISOString(),
      new Date(now.getTime() - 120000).toISOString(),
    )
    .run();
  return { registered: result.meta.changes > 0 };
}
export async function confirmWorkspaceChannel(
  db: Db,
  customerId: string,
  input: Record<string, unknown>,
  now: Date,
) {
  if (
    typeof input.id !== 'string' ||
    typeof input.resourceId !== 'string' ||
    input.resourceId.length > 512 ||
    !input.resourceId ||
    /\p{Cc}/u.test(input.resourceId) ||
    !expires(input.expiresAt, now)
  )
    return false;
  return (
    (
      await db
        .prepare(
          `UPDATE workspace_directory_channels SET resource_id=?,expires_at=? WHERE id=? AND customer_id=?
    AND expires_at>? AND (resource_id IS NULL OR resource_id=?)`,
        )
        .bind(
          input.resourceId,
          String(input.expiresAt),
          input.id,
          customerId,
          now.toISOString(),
          input.resourceId,
        )
        .run()
    ).meta.changes > 0
  );
}
export async function validateWorkspaceChannel(
  db: Db,
  customerId: string,
  input: Record<string, unknown>,
  now: Date,
) {
  if (
    ![input.id, input.resourceId, input.tokenHash, input.event].every(
      (v) => typeof v === 'string' && v.length <= 512,
    )
  )
    return false;
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM workspace_directory_channels WHERE id=? AND customer_id=? AND resource_id=? AND token_hash=?
    AND expires_at>? AND (event=? OR ?='sync')`,
      )
      .bind(
        String(input.id),
        customerId,
        String(input.resourceId),
        String(input.tokenHash),
        now.toISOString(),
        String(input.event),
        String(input.event),
      )
      .first(),
  );
}

/** Advisory only: channelRegister still atomically owns each actual renewal claim. */
export async function dueWorkspaceChannelEvents(
  db: Db,
  customerId: string,
  now: Date,
): Promise<string[]> {
  const due: string[] = [];
  for (const event of EVENTS) {
    // Pin each event so the existing customer/event/expiry index excludes historical channels.
    const covered = await db
      .prepare(
        `SELECT 1 FROM workspace_directory_channels WHERE customer_id=? AND event=? AND expires_at>?
   AND ((resource_id IS NOT NULL AND expires_at>?) OR (resource_id IS NULL AND created_at>?)) LIMIT 1`,
      )
      .bind(
        customerId,
        event,
        now.toISOString(),
        new Date(now.getTime() + 300000).toISOString(),
        new Date(now.getTime() - 120000).toISOString(),
      )
      .first();
    if (!covered) due.push(event);
  }
  return due;
}
