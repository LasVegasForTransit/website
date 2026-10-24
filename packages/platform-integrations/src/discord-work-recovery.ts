import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  workScopeKey,
  type WorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-types';
import {
  operationConversation,
  recoverWorkComment,
  type WorkProviders,
  type WorkEffectContext,
} from './discord-work-actions';
import { findWorkFooter } from './notion-work-links';
import { workString } from './discord-work-input';
import { notionObject } from './notion-task-types';
import type { WorkResult } from './discord-work-types';
async function recoverProvision(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  const p = notionObject(JSON.parse(op.payload_json) as unknown),
    destinationId = workString(p.destinationId);
  if (!destinationId) return { kind: 'paused', reason: 'unconfirmed_effect' };
  const prior = notionObject(op.result_json ? (JSON.parse(op.result_json) as unknown) : {});
  const proof = await providers.discord.discoverWork({
    destinationId,
    operationId: op.id,
    createForum: p.createForum === true,
    isTask: p.intent === 'task',
  });
  if (!proof || (!proof.threadId && (typeof prior.forumId === 'string' || !proof.forumId)))
    return { kind: 'paused', reason: 'unconfirmed_effect' };
  // The next attempt rechecks authority, generation, source, and audience before any write.
  await db
    .prepare(
      "UPDATE discord_work_operations SET state='queued',result_json=?,attempts=0,next_attempt_at=?,reason='recovered_creation',updated_at=? WHERE scope_key=? AND id=? AND state='held'",
    )
    .bind(
      JSON.stringify({ ...prior, ...proof }),
      context.clock().toISOString(),
      context.clock().toISOString(),
      op.scope_key,
      op.id,
    )
    .run();
  return { kind: 'progress' };
}
async function recoverHeld(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  if (op.kind === 'provision') return recoverProvision(db, providers, op, context);
  const c = await operationConversation(db, op, context);
  if (!c) return { kind: 'paused', reason: 'unconfirmed_effect' };
  if (op.kind === 'comment')
    return recoverWorkComment(
      db,
      providers.notion,
      { scope: context.scope, operation: op, conversation: c },
      context.clock(),
    );
  const ids = await findWorkFooter(providers.notion, c);
  if (!ids?.length) return { kind: 'paused', reason: 'unconfirmed_effect' };
  await db
    .prepare(
      "UPDATE discord_work_operations SET state='confirmed',result_json=?,reason=NULL,updated_at=? WHERE scope_key=? AND id=? AND state='held'",
    )
    .bind(
      JSON.stringify({ footerBlockIds: ids }),
      context.clock().toISOString(),
      op.scope_key,
      op.id,
    )
    .run();
  return { kind: 'progress' };
}
export async function recoverOneWorkOperation(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
): Promise<WorkResult> {
  const op = await db
    .prepare(
      "SELECT * FROM discord_work_operations WHERE scope_key=? AND state='held' AND kind IN ('comment','backlink','provision') AND next_attempt_at<=? ORDER BY next_attempt_at,id LIMIT 1",
    )
    .bind(workScopeKey(context.scope), context.clock().toISOString())
    .first<WorkOperation>();
  if (!op) return { kind: 'idle' };
  await db
    .prepare(
      "UPDATE discord_work_operations SET next_attempt_at=? WHERE id=? AND scope_key=? AND state='held'",
    )
    .bind(new Date(context.clock().getTime() + 300_000).toISOString(), op.id, op.scope_key)
    .run();
  try {
    return await recoverHeld(db, providers, op, context);
  } catch {
    return { kind: 'paused', reason: 'unconfirmed_effect' };
  }
}
