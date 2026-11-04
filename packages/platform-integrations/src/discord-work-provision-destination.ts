import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { assertProvisionCurrent, checkpoint } from './discord-work-provision-checkpoint';
import { workString, workSubject } from './discord-work-input';
import { notionObject } from './notion-task-types';
import type { WorkProviders } from './discord-work-actions';
import type { WorkOperation } from './discord-work-types';
import type { DestinationInspection } from './discord-work-provider';
type Payload = Record<string, unknown>;

function createdForumMatches(
  created: DestinationInspection,
  parent: DestinationInspection,
  parentId: string,
): boolean {
  return (
    !created.isCategory &&
    created.destination.kind === 'forum' &&
    created.destination.parentId === parentId &&
    created.audienceFingerprint === parent.audienceFingerprint &&
    created.canRead &&
    created.canSend
  );
}

export async function destinationFor(
  db: Db,
  providers: WorkProviders,
  { p, op }: { p: Payload; op: WorkOperation },
  clock: () => Date,
): Promise<DestinationInspection> {
  const id = workString(p.destinationId);
  if (!id) throw new Error('destination_required');
  const d = await providers.discord.inspectDestination(id);
  if (d.audienceFingerprint !== p.audienceFingerprint) throw new Error('audience_changed');
  const result = notionObject(op.result_json ? (JSON.parse(op.result_json) as unknown) : null);
  if (p.createForum === true) {
    if (!d.isCategory || !d.canManageChannels) throw new Error('forum_permission_required');
    const existing = workString(result.forumId);
    await assertProvisionCurrent(db, op, clock);
    const forum = existing
      ? { channelId: existing }
      : await providers.discord.createProjectForum({
          categoryId: id,
          name: String(p.title).slice(0, 100),
          projectUrl: `https://www.notion.so/${workSubject(p.subject)?.pageId ?? ''}`,
          operationId: op.id,
        });
    await checkpoint(
      db,
      op,
      {
        ...result,
        forumId: forum.channelId,
        ...(!existing ? { postPhase: 'not_started' } : {}),
      },
      clock,
    );
    const created = await providers.discord.inspectDestination(forum.channelId);
    if (!createdForumMatches(created, d, id)) throw new Error('audience_changed');
    return created;
  }
  if (d.isCategory) throw new Error('category_requires_forum_creation');
  if (d.destination.kind === 'thread' && d.privateThread !== false)
    throw new Error('private_thread_unavailable');
  return d;
}
