import type { Db } from './db';
import { workScopeKey, type WorkScope } from './discord-work-types';

export interface PendingWorkRequest {
  id: string;
  page_id: string;
  source_id: string;
  route_id: string;
  route_revision: number;
  existing_event: number;
}
/** Select only an unresolved existing event on the active route, with no possible prior write. */
export async function readReviewedWorkRequest(
  db: Db,
  scope: WorkScope,
  input: { routeId: string; revision: number; id: string },
): Promise<PendingWorkRequest | null> {
  return db
    .prepare(
      `SELECT q.id,q.page_id,q.source_id,q.route_id,q.route_revision,q.existing_event FROM discord_work_requests q JOIN discord_work_routes r ON r.id=q.route_id AND r.scope_key=q.scope_key
    WHERE q.id=? AND q.scope_key=? AND q.route_id=? AND q.route_revision=? AND q.existing_event=1 AND q.state='held' AND q.reason='existing_event_review' AND q.operation_id IS NULL
    AND r.state='active' AND r.revision=q.route_revision AND json_extract(r.data_json,'$.kind')='event'
    AND NOT EXISTS(SELECT 1 FROM discord_work_operations o WHERE o.scope_key=q.scope_key AND o.source_key='route-request:' || q.id)`,
    )
    .bind(input.id, workScopeKey(scope), input.routeId, input.revision)
    .first<PendingWorkRequest>();
}
