import { recoverOneWorkOperation } from './discord-work-recovery';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  dueWorkConversation,
  deferWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  claimWorkOperation,
  queueFooterReconciliation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import {
  processWorkAction,
  refreshWorkCard,
  type WorkProviders,
  type WorkEffectContext,
} from './discord-work-actions';
import { processWorkProvision } from './discord-work-provision';
import { processWorkDestination } from './discord-work-destination';
import { processWorkTopic } from './discord-work-project-topic';
import { processWorkTagSync } from './discord-work-tag-sync';
import { processWorkNameSync } from './discord-work-name-sync';
import { refreshPlanningOverview } from './discord-work-project-refresh';
import { notionObject } from './notion-task-types';
import { ingestWorkConversation } from './discord-work-ingest';
import { processWorkRouteRequest } from './discord-work-route-requests';
import type { WorkOperation, WorkResult } from './discord-work-types';
export interface WorkBatchContext extends WorkEffectContext {
  stage: 'ingest' | 'effects' | 'refresh';
  deadline: number;
  maxLinks: number;
  maxEffects: number;
}
function dispatchClaimedOperation(
  db: Db,
  providers: WorkProviders,
  operation: WorkOperation,
  context: WorkBatchContext,
): Promise<WorkResult> {
  const intent = notionObject(JSON.parse(operation.payload_json) as unknown).intent;
  if (operation.kind === 'provision') {
    if (intent === 'destination') return processWorkDestination(db, providers, operation, context);
    if (intent === 'project-topic') return processWorkTopic(db, providers, operation, context);
    return processWorkProvision(db, providers, operation, context);
  }
  if (operation.kind === 'refresh' && intent === 'tag-sync')
    return processWorkTagSync(db, providers, operation, context);
  if (operation.kind === 'refresh' && intent === 'name-sync')
    return processWorkNameSync(db, providers, operation, context);
  return processWorkAction(db, providers, operation, context);
}
async function effects(
  db: Db,
  providers: WorkProviders,
  context: WorkBatchContext,
): Promise<WorkResult> {
  for (
    let i = 0;
    i < Math.min(context.maxEffects, 1) && context.clock().getTime() < context.deadline;
    i++
  ) {
    const recovered = await recoverOneWorkOperation(db, providers, context);
    if (recovered.kind !== 'idle') return recovered;
    const request = await processWorkRouteRequest(db, providers, context);
    if (request.kind !== 'idle') return request;
    const operation = await claimWorkOperation(db, context.scope, context.clock());
    if (!operation) return { kind: 'idle' };
    return dispatchClaimedOperation(db, providers, operation, context);
  }
  return { kind: 'idle' };
}
export async function runDiscordWorkBatch(
  db: Db,
  providers: WorkProviders,
  context: WorkBatchContext,
): Promise<WorkResult> {
  if (!context.enabled || context.clock().getTime() >= context.deadline) return { kind: 'idle' };
  if (context.stage === 'effects') return effects(db, providers, context);
  if (context.maxLinks < 1) return { kind: 'idle' };
  const c = await dueWorkConversation(
    db,
    { scope: context.scope, stage: context.stage },
    context.clock(),
  );
  if (!c) return { kind: 'idle' };
  let result: WorkResult;
  try {
    if (context.stage === 'ingest')
      result = await ingestWorkConversation(db, providers, c.id, context);
    else {
      const queued = await queueFooterReconciliation(db, c, context.clock());
      result =
        c.subject.kind === 'task'
          ? await refreshWorkCard(db, providers, c, context)
          : await refreshPlanningOverview(db, providers, c, context);
      if (result.kind === 'idle' && queued) result = { kind: 'progress' };
    }
  } catch {
    result = { kind: 'paused', reason: 'connection_unavailable' };
  }
  await deferWorkConversation(
    db,
    { conversation: c, stage: context.stage, reason: result.reason },
    context.clock(),
  );
  return result;
}
