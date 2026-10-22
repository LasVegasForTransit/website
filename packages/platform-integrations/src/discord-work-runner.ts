import { recoverOneWorkOperation } from './discord-work-recovery';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  dueWorkConversation,
  deferWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { claimWorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import {
  processWorkAction,
  refreshWorkCard,
  type WorkProviders,
  type WorkEffectContext,
} from './discord-work-actions';
import { processWorkProvision } from './discord-work-provision';
import { ingestWorkConversation } from './discord-work-ingest';
import type { WorkResult } from './discord-work-types';
export interface WorkBatchContext extends WorkEffectContext {
  stage: 'ingest' | 'effects' | 'refresh';
  deadline: number;
  maxLinks: number;
  maxEffects: number;
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
    const operation = await claimWorkOperation(db, context.scope, context.clock());
    if (!operation) return { kind: 'idle' };
    return operation.kind === 'provision'
      ? processWorkProvision(db, providers, operation, context)
      : processWorkAction(db, providers, operation, context);
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
    result =
      context.stage === 'ingest'
        ? await ingestWorkConversation(db, providers, c.id, context)
        : await refreshWorkCard(db, providers, c, context);
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
