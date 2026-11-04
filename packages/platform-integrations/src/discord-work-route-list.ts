import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { listWorkRoutes } from '@lasvegasfortransit/platform-storage/discord-work-routes';
import type { resolveWorkActor } from './discord-work-authority';
import { notionObject } from './notion-task-types';
import { taskMarkdown } from './notion-task-cards';
import type { DiscordTaskComponent } from './notion-task-cards';
import { setupReceipt, ownedReceipt, setupReply } from './discord-work-setup-common';
import { workMessage, workText, workCustomId, workButton } from './discord-work-cards';
import { savePayload } from './discord-work-route-setup-common';
import type { WorkEffectContext } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';

function savedRouteCard(
  page: Awaited<ReturnType<typeof listWorkRoutes>>,
  receiptId: string,
): WorkPreviewResult {
  const text = page.items
    .map(
      (route, index) =>
        `**${index + 1}. ${taskMarkdown((route.sourceTitle ?? 'Notion source').slice(0, 70))}** · ${route.kind === 'project' ? 'Project forums' : 'Events'} · ${route.state === 'active' ? 'Active' : 'Paused'}\n${taskMarkdown(route.trigger.property.slice(0, 50))}: ${route.trigger.values
          .slice(0, 3)
          .map((value) => taskMarkdown(value.slice(0, 40)))
          .join(
            ', ',
          )}${route.trigger.values.length > 3 ? ', …' : ''}\n<#${route.destination.channelId}>`,
    )
    .join('\n\n');
  const components: DiscordTaskComponent[] = [workText(`### Saved routes\n${text}`)];
  components.push({
    type: 1,
    components: [
      {
        type: 3,
        custom_id: workCustomId({ id: receiptId, generation: 1 }, 'route-edit'),
        placeholder: 'Edit a route',
        options: page.items.map((route, index) => ({
          label: `${index + 1}. ${route.sourceTitle ?? 'Notion source'} · ${route.kind}`.slice(
            0,
            100,
          ),
          value: route.id,
        })),
      },
    ],
  });
  components.push({
    type: 1,
    components: [
      {
        type: 3,
        custom_id: workCustomId({ id: receiptId, generation: 1 }, 'route-manage'),
        placeholder: 'Prepare, activate, or pause',
        options: page.items.map((route, index) => ({
          label: `${index + 1}. ${route.sourceTitle ?? 'Notion source'} · ${route.kind}`.slice(
            0,
            100,
          ),
          value: route.id,
        })),
      },
    ],
  });
  if (page.nextCursor)
    components.push({
      type: 1,
      components: [
        workButton(workCustomId({ id: receiptId, generation: 1 }, 'routes-more'), 'More routes'),
      ],
    });
  return { kind: 'ready', card: workMessage(components) };
}

export async function listRouteControls(
  db: Db,
  context: WorkEffectContext,
  input: WorkPreviewInput,
  actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>,
): Promise<WorkPreviewResult> {
  let cursor = '';
  let receiptId: string;
  let previous: string;
  if (input.intent.action === 'routes') {
    const receipt = await setupReceipt(
      db,
      { request: input, actor, payload: { intent: 'route-list', cursor: '' } },
      context,
    );
    receiptId = receipt.id;
    previous = receipt.payload_json;
  } else {
    const receipt = await ownedReceipt(db, input, context);
    if (
      receipt?.state !== 'preview' ||
      receipt.actor_person_id !== actor.personId ||
      receipt.grant_version !== actor.grantVersion
    )
      return setupReply('This list has expired. Open it again.');
    const payload = notionObject(JSON.parse(receipt.payload_json) as unknown);
    if (payload.intent !== 'route-list' || typeof payload.cursor !== 'string')
      return setupReply('This list is unavailable.');
    cursor = payload.cursor;
    receiptId = receipt.id;
    previous = receipt.payload_json;
  }
  const page = await listWorkRoutes(db, context.scope, cursor);
  if (!page.items.length) return setupReply('No saved routes in this workspace and server.');
  if (
    !(await savePayload(db, receiptId, input.discordUserId, {
      original: previous,
      payload: {
        intent: 'route-list',
        cursor: page.nextCursor,
        routeIds: page.items.map((route) => route.id),
      },
    }))
  )
    return setupReply('This list changed. Open it again.');
  return savedRouteCard(page, receiptId);
}
