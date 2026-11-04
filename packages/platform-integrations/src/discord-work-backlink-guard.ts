import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { authorizeWork } from './discord-work-authority';
import {
  currentWorkAudience,
  type WorkEffectContext,
  type WorkProviders,
} from './discord-work-actions';
import { assertProvisionCurrent } from './discord-work-provision-checkpoint';
import type { WorkConversation, WorkOperation } from './discord-work-types';

export async function canWriteBacklink(
  db: Db,
  providers: WorkProviders,
  { c, op, context }: { c: WorkConversation; op: WorkOperation; context: WorkEffectContext },
): Promise<boolean> {
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject: c.subject,
      taskSourceId: context.taskSourceId,
      conversationId: c.id,
      homeId: c.homeId,
      generation: op.generation,
      discordUserId: op.actor_discord_id,
      action: c.subject.kind === 'task' ? 'comment' : 'manage_home',
    },
    context.clock(),
  );
  if (actor?.personId !== op.actor_person_id || actor.grantVersion !== op.grant_version)
    return false;
  if (!(await currentWorkAudience(db, providers, c))) return false;
  await assertProvisionCurrent(db, op, context.clock);
  return true;
}
