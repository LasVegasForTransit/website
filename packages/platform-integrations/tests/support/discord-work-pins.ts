import assert from 'node:assert/strict';
import type { WorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-types';
import { processWorkProjectPins } from '../../src/discord-work-project-pins';
import type { WorkEffectContext, WorkProviders } from '../../src/discord-work-actions';
import type { workFixture } from './discord-work';

export async function runQueuedProjectPins(
  db: ReturnType<typeof workFixture>['db'],
  providers: WorkProviders,
  context: WorkEffectContext,
) {
  const token = crypto.randomUUID();
  const op = db.raw
    .prepare(
      "UPDATE discord_work_operations SET state='processing',claim_token=?,lease_expires_at=? WHERE id=(SELECT id FROM discord_work_operations WHERE kind='refresh' AND json_extract(payload_json,'$.intent')='project-pins' AND state='queued' LIMIT 1) RETURNING *",
    )
    .get(token, new Date(context.clock().getTime() + 60_000).toISOString()) as
    WorkOperation | undefined;
  assert.ok(op);
  return processWorkProjectPins(db, providers, op, context);
}
