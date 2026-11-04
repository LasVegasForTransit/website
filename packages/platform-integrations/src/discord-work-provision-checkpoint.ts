import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { notionObject } from './notion-task-types';
import type { WorkOperation, ProjectHome } from './discord-work-types';

export async function checkpoint(
  db: Db,
  op: WorkOperation,
  value: Record<string, unknown>,
  clock: () => Date,
): Promise<void> {
  const result = await db
    .prepare(
      "UPDATE discord_work_operations SET result_json=? WHERE id=? AND state='processing' AND claim_token=? AND lease_expires_at>?",
    )
    .bind(JSON.stringify(value), op.id, op.claim_token, clock().toISOString())
    .run();
  if (!result.meta.changes) throw new Error('provision_lease_changed');
  op.result_json = JSON.stringify(value);
}
export async function assertProvisionCurrent(
  db: Db,
  op: WorkOperation,
  clock: () => Date,
  home?: ProjectHome,
): Promise<void> {
  const payload = notionObject(JSON.parse(op.payload_json) as unknown);
  const routeId = typeof payload.routeId === 'string' ? payload.routeId : null;
  const routeRevision = typeof payload.routeRevision === 'number' ? payload.routeRevision : null;
  if ((routeId === null) !== (routeRevision === null)) throw new Error('link_changed');
  const row = await db
    .prepare(
      `SELECT 1 FROM discord_work_operations WHERE id=? AND scope_key=? AND claim_token=? AND state='processing' AND lease_expires_at>? AND (? IS NULL OR EXISTS(SELECT 1 FROM discord_project_homes WHERE id=? AND scope_key=? AND generation=? AND state='active')) AND (? IS NULL OR EXISTS(SELECT 1 FROM discord_work_routes WHERE id=? AND scope_key=? AND revision=? AND state='active'))`,
    )
    .bind(
      op.id,
      op.scope_key,
      op.claim_token,
      clock().toISOString(),
      home?.id ?? null,
      home?.id ?? null,
      op.scope_key,
      home?.generation ?? 0,
      routeId,
      routeId,
      op.scope_key,
      routeRevision,
    )
    .first();
  if (!row) throw new Error('link_changed');
}
