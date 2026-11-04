import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { listWorkConversations } from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  workScopeKey,
  type ProjectHome,
  type WorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-types';
import { authorizeWork } from './discord-work-authority';
import type { WorkEffectContext, WorkProviders } from './discord-work-actions';
import type { WorkPreviewInput } from './discord-work-interactions';

const reasons: Record<string, string> = {
  planning_name_changed: 'Automatic renaming stopped because an organizer changed the name.',
  planning_post_archived:
    'The post is archived. Reopen it yourself and run /work sync-name to retry.',
  planning_post_locked: 'The post is locked. Unlock it yourself and run /work sync-name to retry.',
  permission_denied: 'The bot cannot rename this resource. Check its Discord permissions.',
  unconfirmed_effect:
    'A name update needs review; Discord may already have applied it. Inspect the current name, then run /work resolve-name to accept it.',
};

export async function nameSyncNotices(
  db: Db,
  providers: WorkProviders,
  {
    input,
    context,
    data,
  }: {
    input: WorkPreviewInput;
    context: WorkEffectContext;
    data: { homes: ProjectHome[]; conversations: WorkConversation[] };
  },
): Promise<string[]> {
  const linked = (
    await Promise.all(data.homes.map((h) => listWorkConversations(db, context.scope, h.id)))
  ).flat();
  const conversations = [
    ...new Map([...data.conversations, ...linked].map((c) => [c.id, c])).values(),
  ].slice(0, 10);
  const lines: string[] = [];
  for (const c of conversations) {
    const actor = await authorizeWork(
      db,
      providers,
      {
        scope: context.scope,
        subject: c.subject,
        taskSourceId: context.taskSourceId,
        homeId: c.homeId,
        conversationId: c.id,
        generation: c.generation,
        discordUserId: input.discordUserId,
        action: 'manage_home',
      },
      context.clock(),
    );
    if (!actor) continue;
    const rows = await db
      .prepare(
        `SELECT o.reason FROM discord_work_operations o JOIN discord_work_conversations c ON c.id=o.conversation_id AND c.scope_key=o.scope_key JOIN discord_project_homes h ON h.id=c.home_id AND h.scope_key=c.scope_key WHERE o.scope_key=? AND o.conversation_id=? AND o.kind='refresh' AND o.state IN ('held','failed') AND json_extract(o.payload_json,'$.intent')='name-sync' AND json_extract(o.payload_json,'$.revision')=coalesce(json_extract(CASE WHEN json_extract(o.payload_json,'$.target')='forum' THEN h.data_json ELSE c.data_json END,'$.nameSyncRevision'),'created') AND NOT EXISTS(SELECT 1 FROM discord_work_operations later WHERE later.scope_key=o.scope_key AND later.conversation_id=o.conversation_id AND later.kind='refresh' AND later.state='confirmed' AND json_extract(later.payload_json,'$.intent')='name-sync' AND json_extract(later.payload_json,'$.target')=json_extract(o.payload_json,'$.target') AND json_extract(later.payload_json,'$.revision')=json_extract(o.payload_json,'$.revision') AND later.rowid>o.rowid) ORDER BY o.rowid DESC LIMIT 2`,
      )
      .bind(workScopeKey(context.scope), c.id)
      .all<{ reason: string | null }>();
    for (const row of rows.results)
      lines.push(
        reasons[row.reason ?? ''] ??
          'A name update needs attention. Check the link and bot access.',
      );
  }
  return [...new Set(lines)];
}
