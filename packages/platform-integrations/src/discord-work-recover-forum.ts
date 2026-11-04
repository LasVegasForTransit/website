import type { Db } from '@lasvegasfortransit/platform-storage/db';
import type { WorkProviders, WorkEffectContext } from './discord-work-actions';
import type { WorkOperation, WorkResult } from './discord-work-types';
import type { WorkDiscovery } from './discord-work-discovery';

function candidateForum(
  op: WorkOperation,
  proof: WorkDiscovery | null,
  payload: Record<string, unknown>,
): string | null {
  if (
    payload.intent !== 'home' ||
    payload.createForum !== true ||
    typeof payload.audienceFingerprint !== 'string' ||
    op.result_json !== null ||
    op.home_id !== null ||
    !proof?.forumId ||
    proof.threadId ||
    proof.starterMessageId ||
    proof.cardChannelId
  )
    return null;
  return proof.forumId;
}

/** A missing checkpoint proves no overview was attempted: it precedes every post write. */
export async function recoverDiscoveredForum(
  db: Db,
  providers: WorkProviders,
  input: {
    op: WorkOperation;
    context: WorkEffectContext;
    proof: WorkDiscovery | null;
    payload: Record<string, unknown>;
    destinationId: string;
  },
): Promise<WorkResult | null> {
  const { op, context, proof, payload, destinationId } = input;
  const forumId = candidateForum(op, proof, payload);
  if (!forumId) return null;
  const forum = await providers.discord.inspectDestination(forumId);
  if (
    forum.destination.kind !== 'forum' ||
    forum.destination.channelId !== forumId ||
    forum.destination.parentId !== destinationId ||
    !forum.canRead ||
    !forum.canSend ||
    forum.audienceFingerprint !== payload.audienceFingerprint
  )
    return { kind: 'paused', reason: 'unconfirmed_effect' };
  const now = context.clock().toISOString();
  const result = await db
    .prepare(
      "UPDATE discord_work_operations SET state='queued',result_json=?,attempts=0,next_attempt_at=?,reason='recovered_forum',updated_at=? WHERE scope_key=? AND id=? AND state='held' AND result_json IS NULL AND home_id IS NULL",
    )
    .bind(JSON.stringify({ forumId, postPhase: 'not_started' }), now, now, op.scope_key, op.id)
    .run();
  return result.meta.changes ? { kind: 'progress' } : { kind: 'paused', reason: 'link_changed' };
}
