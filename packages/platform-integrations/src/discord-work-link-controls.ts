import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  listProjectHomesAtDestination,
  listWorkConversationsAtThread,
  readProjectHome,
  unlinkWork,
  type ProjectHome,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { authorizeWork, resolveWorkActor } from './discord-work-authority';
import { notionWorkUrl } from './discord-work-input';
import { taskMarkdown } from './notion-task-cards';
import { setupReply } from './discord-work-setup-common';
import type { WorkProviders, WorkEffectContext } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';

function backlinkStatus(backlink: { state: string } | null): string {
  if (backlink?.state === 'confirmed') return 'Last Notion link write: confirmed.';
  if (backlink?.state === 'held' || backlink?.state === 'failed')
    return 'Notion link needs attention.';
  return backlink ? 'Notion link is waiting to be written.' : 'Notion link status is unavailable.';
}
function conversationNotice(reason: string | undefined): string {
  if (reason === 'audience_or_permission_changed' || reason === 'link_or_audience_changed')
    return '\nSync paused. Check the approved audience and Discord channel permissions.';
  if (reason === 'message_content_unavailable')
    return '\nSync paused. Check the bot’s Message Content access and linked message content.';
  return reason ? '\nSync needs attention. Check account access and channel permissions.' : '';
}
function conversationLabel(kind: string): string {
  if (kind === 'project_plan') return 'Project overview';
  return kind === 'event_plan' ? 'Event conversation' : 'Work conversation';
}

async function conversationStatusLines(
  db: Db,
  context: WorkEffectContext,
  here: Awaited<ReturnType<typeof listWorkConversationsAtThread>>,
): Promise<string[]> {
  const lines: string[] = [];
  for (const c of here) {
    const backlink = await db
      .prepare(
        "SELECT state FROM discord_work_operations WHERE scope_key=? AND source_key=? AND kind='backlink'",
      )
      .bind(
        JSON.stringify([
          context.scope.environment,
          context.scope.guildId,
          context.scope.workspaceId,
        ]),
        `backlink:${c.id}`,
      )
      .first<{ state: string }>();
    const status = backlinkStatus(backlink);
    lines.push(
      `**${conversationLabel(c.subject.kind)}**\nhttps://discord.com/channels/${context.scope.guildId}/${c.threadId}\n${status}${conversationNotice(c.reason)}`,
    );
  }
  return lines;
}

const footerReasons: Record<string, string> = {
  forum_topic_changed:
    'The forum topic changed after review. Run /work project-topic to review it again.',
  tag_mapping_unavailable:
    'The Notion value or its forum tag is unavailable. Review the mapping and forum tags.',
  forum_tags_changed:
    'The forum post tags changed during sync. Review the post and mapping before trying again.',
  private_thread_unavailable:
    'Private threads cannot be linked. Choose a public thread or another approved destination.',
  eligibility_changed_after_effect:
    'The page no longer matches the route after Discord creation began. Review the existing Discord resource and link before repair.',
  footer_modified:
    'The Notion footer was edited. Review the page and its link before repairing or relinking it.',
  footer_missing:
    'The recorded Notion footer is missing. Review the page and its link before repairing or relinking it.',
  footer_ownership_unverified:
    'The Notion footer could not be verified. Review the page and its link before repairing or relinking it.',
  multiple_managed_footers:
    'The Notion page has multiple matching footers. Review them before repairing or relinking it.',
  footer_scan_limit:
    'The Notion page is too long to verify its footer. Review the page before repairing or relinking it.',
  footer_changed_during_repair:
    'The Notion footer changed during repair. Review the page before repairing or relinking it.',
};

function moreLinksExist(
  foundHomes: ProjectHome[],
  foundHere: Awaited<ReturnType<typeof listWorkConversationsAtThread>>,
  relevant: ProjectHome[],
): boolean {
  return foundHomes.length > 5 || foundHere.length > 5 || relevant.length > 5;
}

export async function show(
  db: Db,
  _providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const pageId = notionWorkUrl(input.intent.url);
  if (input.intent.url && !pageId) return setupReply('Provide a valid Notion page URL.');
  const [foundHomes, foundHere] = await Promise.all([
    listProjectHomesAtDestination(db, context.scope, input.channelId, pageId ?? undefined),
    listWorkConversationsAtThread(db, context.scope, input.channelId, pageId ?? undefined),
  ]);
  const homes = foundHomes.slice(0, 5),
    here = foundHere.slice(0, 5);
  const associated = (
    await Promise.all(here.map((c) => readProjectHome(db, context.scope, c.homeId)))
  ).filter((home): home is ProjectHome => Boolean(home && home.state !== 'unlinked'));
  const allRelevant = [
    ...new Map([...homes, ...associated].map((home) => [home.id, home])).values(),
  ];
  const relevant = allRelevant.slice(0, 5);
  const lines = relevant.map(
    (h) =>
      `**${taskMarkdown(h.title ?? (h.kind === 'event' ? 'Event' : 'Project'))}** · ${h.state === 'active' ? 'Linked' : 'Paused'}\nhttps://discord.com/channels/${context.scope.guildId}/${h.kind === 'event' ? (here.find((c) => c.homeId === h.id)?.threadId ?? h.destination.channelId) : h.destination.channelId}${h.overviewPin === 'needs_attention' ? '\nThe overview message pin could not be confirmed. Check the post and Discord permissions.' : ''}${h.overviewPostPin === 'needs_attention' ? '\nThe overview post pin could not be confirmed. Check the forum and Manage Threads permission.' : ''}`,
  );
  lines.push(...(await conversationStatusLines(db, context, here)));
  if (moreLinksExist(foundHomes, foundHere, allRelevant))
    lines.push(
      'More links exist in this location. Use /work show url: with a Notion page to inspect a specific record.',
    );
  const row = await db
    .prepare(
      `SELECT o.state,o.reason,o.updated_at FROM discord_work_operations o
       WHERE o.scope_key=? AND o.actor_person_id=? AND o.state IN ('held','failed')
       AND (o.home_id IN (SELECT value FROM json_each(?)) OR json_extract(o.payload_json,'$.destinationId')=?)
       AND (coalesce(json_extract(o.payload_json,'$.intent'),'') <> 'project-topic' OR NOT EXISTS (
         SELECT 1 FROM discord_work_operations later WHERE later.scope_key=o.scope_key AND later.home_id=o.home_id
         AND later.state='confirmed' AND json_extract(later.payload_json,'$.intent')='project-topic'
         AND later.rowid>o.rowid
       )) AND (o.state='held' OR coalesce(json_extract(o.payload_json,'$.intent'),'') <> 'tag-sync' OR NOT EXISTS (
         SELECT 1 FROM discord_work_operations later WHERE later.scope_key=o.scope_key AND later.conversation_id=o.conversation_id
         AND later.kind='refresh' AND later.state='confirmed' AND json_extract(later.payload_json,'$.intent')='tag-sync'
         AND json_extract(later.payload_json,'$.routeId')=json_extract(o.payload_json,'$.routeId')
         AND json_extract(later.payload_json,'$.routeRevision')=json_extract(o.payload_json,'$.routeRevision') AND later.rowid>o.rowid
       )) ORDER BY o.updated_at DESC,o.rowid DESC LIMIT 1`,
    )
    .bind(
      JSON.stringify([context.scope.environment, context.scope.guildId, context.scope.workspaceId]),
      (await resolveWorkActor(db, context.scope, input.discordUserId))?.personId ?? '',
      JSON.stringify(relevant.map((h) => h.id)),
      input.channelId,
    )
    .first<{ state: string; reason: string; updated_at: string }>();
  if (!relevant.length && !row) return setupReply(t('discordWork.none'));
  if (row) {
    lines.push(
      footerReasons[row.reason] ??
        (row.state === 'held'
          ? 'An update is waiting for confirmation. It will not be sent again unless the original result can be verified.'
          : 'An update could not be completed. Check access before trying again.'),
    );
  }
  return setupReply(
    lines.join('\n\n') + (!context.enabled ? `\n\n${t('discordWork.disabled')}` : ''),
  );
}
async function resolveUnlinkTarget(
  db: Db,
  context: WorkEffectContext,
  {
    local,
    input,
    pageId,
  }: {
    local: Awaited<ReturnType<typeof listWorkConversationsAtThread>>;
    input: WorkPreviewInput;
    pageId: string | null;
  },
) {
  const overviewHomeIds = new Set(
    local.filter((v) => v.subject.kind === 'project_plan').map((v) => v.homeId),
  );
  const candidates = local.filter(
    (v) =>
      v.threadId === input.channelId &&
      (v.subject.kind === 'task' || v.subject.kind === 'event_plan') &&
      (!pageId || v.subject.pageId === pageId),
  );
  if (candidates.length > 1)
    return {
      error:
        'Several records share this conversation. Use /work unlink url: with the intended Notion URL.',
    } as const;
  const [c] = candidates;
  const possibleHomes = c
    ? []
    : [
        ...new Map(
          [
            ...(await listProjectHomesAtDestination(
              db,
              context.scope,
              input.channelId,
              pageId ?? undefined,
            )),
            ...(
              await Promise.all(
                [...overviewHomeIds].map((id) => readProjectHome(db, context.scope, id)),
              )
            ).filter((home): home is ProjectHome => Boolean(home && home.state !== 'unlinked')),
          ]
            .filter((h) => !pageId || h.projectId === pageId)
            .map((h) => [h.id, h]),
        ).values(),
      ];
  if (possibleHomes.length > 1)
    return {
      error:
        'Several projects share this location. Use /work unlink url: with the intended Notion URL.',
    } as const;
  const home = c ? await readProjectHome(db, context.scope, c.homeId) : possibleHomes[0];
  if (!home) return { error: t('discordWork.noHome') } as const;
  return { home, c } as const;
}

async function removeSelectedLink(
  db: Db,
  context: WorkEffectContext,
  {
    task,
    home,
  }: {
    task: Awaited<ReturnType<typeof listWorkConversationsAtThread>>[number] | undefined;
    home: ProjectHome;
  },
): Promise<boolean> {
  return unlinkWork(
    db,
    {
      scope: context.scope,
      id: task?.id ?? home.id,
      generation: task?.generation ?? home.generation,
    },
    context.clock(),
  );
}

export async function unlink(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const pageId = notionWorkUrl(input.intent.url);
  if (input.intent.url && !pageId) return setupReply('Provide a valid Notion page URL.');
  const local = await listWorkConversationsAtThread(
    db,
    context.scope,
    input.channelId,
    pageId ?? undefined,
  );
  if (local.length > 50)
    return setupReply(
      'Too many links share this conversation. Contact an administrator to inspect them before unlinking.',
    );
  const target = await resolveUnlinkTarget(db, context, { local, input, pageId });
  if ('error' in target) return setupReply(target.error);
  const { home, c } = target;
  const task = c?.subject.kind === 'task' ? c : undefined;
  const subject = c?.subject ?? {
    kind: 'project_plan' as const,
    sourceId: home.projectSourceId,
    pageId: home.projectId,
  };
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject,
      taskSourceId: context.taskSourceId,
      discordUserId: input.discordUserId,
      action: task ? 'place_work' : 'manage_home',
    },
    context.clock(),
  );
  if (!actor && !(await resolveWorkActor(db, context.scope, input.discordUserId))?.administrator)
    return setupReply(t('discordWork.unavailable'));
  const unlinked = await removeSelectedLink(db, context, { task, home });
  return setupReply(
    unlinked ? t('discordWork.unlinked') : 'This link changed. Open /work show and try again.',
  );
}
