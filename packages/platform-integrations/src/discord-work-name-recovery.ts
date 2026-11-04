import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readProjectHome,
  readWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  currentWorkAudience,
  type WorkEffectContext,
  type WorkProviders,
} from './discord-work-actions';
import { notionObject } from './notion-task-types';
import { validateNameSyncLink } from './discord-work-name-sync';
import type { WorkOperation, WorkResult } from './discord-work-types';

function hasRecoveryProof(
  saved: Record<string, unknown>,
  title: string,
  observed: string,
): boolean {
  return typeof saved.previous === 'string' && saved.title === title && observed === saved.title;
}

export async function recoverWorkNameSync(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  try {
    const payload = notionObject(JSON.parse(op.payload_json) as unknown);
    const c = op.conversation_id
      ? await readWorkConversation(db, context.scope, op.conversation_id)
      : null;
    const home = c ? await readProjectHome(db, context.scope, c.homeId) : null;
    if (!c || !home) return { kind: 'paused', reason: 'link_changed' };
    validateNameSyncLink(c, home, op, payload);
    if (!(await currentWorkAudience(db, providers, c)))
      return { kind: 'paused', reason: 'audience_changed' };
    const saved = notionObject(op.result_json ? (JSON.parse(op.result_json) as unknown) : null);
    const isForum = payload.target === 'forum';
    const destination = isForum ? home.destination.channelId : c.threadId;
    if (
      !hasRecoveryProof(saved, payload.title, await providers.discord.readPlanningName(destination))
    )
      return { kind: 'paused', reason: 'unconfirmed_effect' };
    const table = isForum ? 'discord_project_homes' : 'discord_work_conversations';
    const id = isForum ? home.id : c.id;
    const generation = isForum ? home.generation : c.generation;
    await db
      .prepare(
        `UPDATE ${table} SET data_json=json_set(data_json,'$.managedName',?),updated_at=? WHERE id=? AND scope_key=? AND state='active' AND generation=? AND json_extract(data_json,'$.managedName')=? AND coalesce(json_extract(data_json,'$.nameSyncRevision'),'created')=?`,
      )
      .bind(
        String(saved.title),
        context.clock().toISOString(),
        id,
        op.scope_key,
        generation,
        String(saved.previous),
        typeof payload.revision === 'string' ? payload.revision : '',
      )
      .run();
    const result = await db
      .prepare(
        "UPDATE discord_work_operations SET state='confirmed',reason=NULL,updated_at=? WHERE id=? AND scope_key=? AND state='held' AND result_json=?",
      )
      .bind(context.clock().toISOString(), op.id, op.scope_key, op.result_json)
      .run();
    return result.meta.changes ? { kind: 'progress' } : { kind: 'paused', reason: 'link_changed' };
  } catch {
    return { kind: 'paused', reason: 'unconfirmed_effect' };
  }
}
