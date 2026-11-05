import type { Db } from './db';
import { pendingGoogleOperations } from './google-pending';
/** Advisory only: the executor still claims and revalidates the exact current plan. */
export async function workspaceGroupsDue(db: Db, customerId: string, now: Date): Promise<boolean> {
  const consoleDue = await db
    .prepare(
      `SELECT 1 FROM workspace_directory_accounts WHERE customer_id=? AND console_due_at<=?
  AND (identity_record_id IS NOT NULL OR state='revoked') AND (console_lease_until IS NULL OR console_lease_until<=?) LIMIT 1`,
    )
    .bind(customerId, now.toISOString(), now.toISOString())
    .first();
  if (consoleDue) return true;
  for (const operationId of await pendingGoogleOperations(db, now, 10)) {
    const retry = await db
      .prepare('SELECT 1 FROM workspace_google_retries WHERE operation_id=? AND next_attempt_at>?')
      .bind(operationId, now.toISOString())
      .first();
    if (!retry) return true;
  }
  return false;
}
