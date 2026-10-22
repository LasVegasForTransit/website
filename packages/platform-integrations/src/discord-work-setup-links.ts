import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  listProjectHomes,
  findWorkSubject,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { authorizeWork, readWorkSource, readWorkTask } from './discord-work-authority';
import { notionWorkUrl, notionWorkId, workString } from './discord-work-input';
import { notionObject } from './notion-task-types';
import { taskMarkdown } from './notion-task-cards';
import { setupReply, setupReceipt, receiptCard } from './discord-work-setup-common';
import type { WorkProviders, WorkEffectContext } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';
import type { WorkSubject, ProjectHome } from './discord-work-types';
function homeDescription(createForum: boolean | undefined): string {
  return createForum
    ? `${t('discordWork.projectForum')}\n\n${t('discordWork.audience')}`
    : t('discordWork.audience');
}
export async function sourceSubject(
  db: Db,
  providers: WorkProviders,
  pageId: string,
  context: WorkEffectContext,
): Promise<{ subject: WorkSubject; title: string } | null> {
  const source = await readWorkSource(db, context.taskSourceId, context.scope);
  if (!source) return null;
  const page = notionObject(await providers.notion.readPage(pageId)),
    parent = notionWorkId(notionObject(page.parent).data_source_id);
  if (notionWorkId(page.id) !== pageId || page.archived === true || page.in_trash === true)
    return null;
  const kind =
    parent === notionWorkId(context.taskSourceId)
      ? 'task'
      : parent === notionWorkId(source.policy.projectsSourceId)
        ? 'project_plan'
        : null;
  if (!kind || !parent) return null;
  const titleProperty = Object.values(notionObject(page.properties))
    .map(notionObject)
    .find((p) => p.type === 'title');
  const values = titleProperty?.title;
  const title = Array.isArray(values)
    ? values
        .map((v) => {
          const r = notionObject(v);
          return (
            workString(r.plain_text, 2000) ?? workString(notionObject(r.text).content, 2000) ?? ''
          );
        })
        .join('')
        .slice(0, 200)
    : 'Linked work';
  return { subject: { kind, sourceId: parent, pageId }, title: title || 'Linked work' };
}
export async function linkHome(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const pageId = notionWorkUrl(input.intent.url);
  if (!pageId) return setupReply(t('discordWork.unavailable'));
  const page = await sourceSubject(db, providers, pageId, context);
  if (!page) return setupReply(t('discordWork.unavailable'));
  if (page.subject.kind === 'task') return linkTask(db, providers, { input, page }, context);
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject: page.subject,
      taskSourceId: context.taskSourceId,
      discordUserId: input.discordUserId,
      action: 'manage_home',
    },
    context.clock(),
  );
  if (!actor) return setupReply(t('discordWork.unavailable'));
  const existing = (await listProjectHomes(db, context.scope)).find((h) => h.projectId === pageId);
  if (existing)
    return setupReply(
      `### ${taskMarkdown(existing.title ?? page.title)}\nhttps://discord.com/channels/${context.scope.guildId}/${existing.destination.channelId}`,
    );
  const destination = await providers.discord.inspectDestination(
    input.intent.destinationId ?? input.channelId,
  );
  if (!destination.canRead || (!destination.canSend && !destination.isCategory))
    return setupReply(t('discordWork.unavailable'));
  const tags =
    destination.requiredTag && destination.tags.length === 1 ? [destination.tags[0]?.id ?? ''] : [];
  const receipt = await setupReceipt(
    db,
    {
      request: input,
      actor,
      payload: {
        intent: 'home',
        linkId: crypto.randomUUID(),
        subject: page.subject,
        title: page.title,
        destinationId: destination.destination.channelId,
        audienceFingerprint: destination.audienceFingerprint,
        createForum: destination.isCategory === true,
        description: homeDescription(destination.isCategory),
        requiredTag: destination.requiredTag,
        availableTags: destination.tags,
        tagIds: tags,
      },
    },
    context,
  );
  return receiptCard(receipt, context);
}
async function linkTask(
  db: Db,
  providers: WorkProviders,
  request: { input: WorkPreviewInput; page: { subject: WorkSubject; title: string } },
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const { input, page } = request;
  const homes = await listProjectHomes(db, context.scope),
    source = await readWorkSource(db, context.taskSourceId, context.scope);
  const task = source ? await readWorkTask(providers, source, page.subject) : null;
  if (!task) return setupReply(t('discordWork.unavailable'));
  const target = await providers.discord.inspectDestination(
    input.intent.destinationId ?? input.channelId,
  );
  const candidates = homes.filter(
    (h) =>
      task.projectIds.includes(h.projectId) &&
      [target.destination.channelId, target.destination.parentId].includes(h.destination.channelId),
  );
  const [candidate] = candidates;
  if (!candidate || candidates.length !== 1) return setupReply(t('discordWork.noHome'));
  return prepareTaskLink(
    db,
    providers,
    {
      input,
      home: candidate,
      subject: page.subject,
      title: page.title,
      destinationId: target.destination.channelId,
    },
    context,
  );
}
export async function prepareTaskLink(
  db: Db,
  providers: WorkProviders,
  request: {
    input: WorkPreviewInput;
    home: ProjectHome;
    subject: WorkSubject;
    title: string;
    destinationId?: string;
  },
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const { input, home, subject, title } = request;
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject,
      homeId: home.id,
      taskSourceId: context.taskSourceId,
      discordUserId: input.discordUserId,
      action: 'place_work',
    },
    context.clock(),
  );
  if (!actor) return setupReply(t('discordWork.unavailable'));
  const existing = await findWorkSubject(db, context.scope, subject);
  if (existing)
    return setupReply(
      `### ${taskMarkdown(title)}\nhttps://discord.com/channels/${context.scope.guildId}/${existing.threadId}`,
    );
  const approved = await providers.discord.inspectDestination(home.destination.channelId);
  if (approved.audienceFingerprint !== home.audienceFingerprint)
    return setupReply(t('discordWork.unavailable'));
  const destination = await providers.discord.inspectDestination(
    request.destinationId ?? (home.taskParent ?? home.destination).channelId,
  );
  const automatic =
    home.destination.kind !== 'thread' && (await providers.discord.messageContentAvailable());
  const receipt = await setupReceipt(
    db,
    {
      request: input,
      actor,
      payload: {
        intent: 'task',
        linkId: crypto.randomUUID(),
        homeId: home.id,
        homeGeneration: home.generation,
        projectId: home.projectId,
        subject,
        title,
        destinationId: destination.destination.channelId,
        audienceFingerprint: destination.audienceFingerprint,
        mode: automatic ? 'automatic' : 'selected',
        description: automatic ? t('discordWork.automatic') : t('discordWork.automaticUnavailable'),
        requiredTag: destination.requiredTag,
        availableTags: destination.tags,
        tagIds:
          destination.requiredTag && destination.tags.length === 1
            ? [destination.tags[0]?.id ?? '']
            : [],
      },
    },
    context,
  );
  return receiptCard(receipt, context);
}
