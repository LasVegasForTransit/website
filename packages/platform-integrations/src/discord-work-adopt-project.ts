import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { hasOtherProjectHome } from '@lasvegasfortransit/platform-storage/discord-work-links';
import { authorizeWork } from './discord-work-authority';
import { notionWorkUrl } from './discord-work-input';
import { sourceSubject } from './discord-work-setup-links';
import { validateAdoptedThread } from './discord-work-adopt-destination';
import { setupReceipt, receiptCard, setupReply } from './discord-work-setup-common';
import type { WorkProviders, WorkEffectContext } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';

/** Preview adoption of a human-created project overview in its existing forum. */
export async function adoptProject(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  if (!context.enabled) return setupReply('Project linking is disabled.');
  const pageId = notionWorkUrl(input.intent.url);
  if (!pageId) return setupReply('Provide the Notion project page URL.');
  const page = await sourceSubject(db, providers, pageId, context);
  if (page?.subject.kind !== 'project_plan') return setupReply('The project page is unavailable.');
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject: page.subject,
      discordUserId: input.discordUserId,
      action: 'manage_home',
      taskSourceId: context.taskSourceId,
    },
    context.clock(),
  );
  if (!actor) return setupReply('Administrator access is required.');
  if (
    await hasOtherProjectHome(db, context.scope, {
      sourceId: page.subject.sourceId,
      projectId: page.subject.pageId,
      exceptId: '',
    })
  )
    return setupReply('This project is already linked. Use /work show to inspect it.');
  const thread = await providers.discord.inspectDestination(input.channelId);
  if (thread.privateThread === true)
    return setupReply(
      'Private threads cannot be adopted because their audience may differ from the parent channel.',
    );
  const parentId = thread.destination.parentId;
  if (!parentId) return setupReply('Run this inside an existing project forum post.');
  const forum = await providers.discord.inspectDestination(parentId);
  if (
    forum.isCategory ||
    forum.destination.kind !== 'forum' ||
    !forum.canRead ||
    !forum.canSend ||
    !validateAdoptedThread({
      thread,
      expectedParentId: parentId,
      approvedAudience: forum.audienceFingerprint,
    })
  )
    return setupReply('The project forum post or its audience is unavailable.');
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
        destinationId: parentId,
        adoptThreadId: input.channelId,
        audienceFingerprint: forum.audienceFingerprint,
        createForum: false,
        tagIds: [],
        description:
          'Connect this existing forum post to the project. The bot will add a Notion link here, and the Notion page will link to this post.',
      },
    },
    context,
  );
  return receiptCard(receipt, context);
}
