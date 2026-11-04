import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readWorkRoute,
  saveWorkRoute,
  type WorkRoute,
} from '@lasvegasfortransit/platform-storage/discord-work-routes';
import { consumeWorkPreview } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { resolveWorkActor } from './discord-work-authority';
import { inspectWorkSourceFields } from './discord-work-source-discovery';
import { previewWorkRoute } from './discord-work-route-preview';
import { notionObject } from './notion-task-types';
import { savePayload } from './discord-work-route-setup-common';
import { forumForRoute, selectCard } from './discord-work-tag-setup-cards';
import { taskMarkdown } from './notion-task-cards';
import { setupReceipt, ownedReceipt, setupReply } from './discord-work-setup-common';
import { workMessage, workText, workButton, workCustomId } from './discord-work-cards';
import type { WorkProviders, WorkEffectContext } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';

async function startTagMapping(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    input,
    actor,
    route,
    p,
  }: {
    input: WorkPreviewInput;
    actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>;
    route: WorkRoute;
    p: Record<string, unknown>;
  },
): Promise<WorkPreviewResult> {
  if (p.intent !== 'route-manage') return setupReply('Open the route from /work routes again.');
  const setup = await setupReceipt(
    db,
    {
      request: input,
      actor,
      payload: {
        intent: 'tag-setup',
        routeId: route.id,
        revision: route.revision,
        forumId: route.destination.kind === 'forum' ? route.destination.channelId : null,
      },
    },
    context,
  );
  if (route.destination.kind === 'category')
    return {
      kind: 'ready',
      card: workMessage([
        workText(
          'Choose a project forum in the approved category as the tag example. Other project forums need tags with the same names.',
        ),
        {
          type: 1,
          components: [
            {
              type: 8,
              custom_id: workCustomId({ id: setup.id, generation: 1 }, 'route-tags-forum'),
              placeholder: 'Choose a project forum',
              channel_types: [15],
            },
          ],
        },
      ]),
    };
  return tagMappingSetup(
    db,
    providers,
    {
      ...input,
      intent: {
        action: 'route-tags-forum',
        linkId: setup.id,
        value: route.destination.channelId,
      },
    },
    context,
  );
}

async function saveTagMapping(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    input,
    receipt,
    route,
    actor,
    mappings,
    field,
  }: {
    input: WorkPreviewInput;
    receipt: NonNullable<Awaited<ReturnType<typeof ownedReceipt>>>;
    route: WorkRoute;
    actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>;
    mappings: Record<string, unknown>[];
    field: { name: string; values: string[] };
  },
): Promise<WorkPreviewResult> {
  if (input.intent.action !== 'route-tags-save' || mappings.length !== field.values.length)
    return setupReply('Complete the mapping before saving.');
  const tagSync = {
    property: field.name,
    mappings: mappings.map((item) => ({
      value: String(item.value),
      tagName: String(item.tagName),
    })),
  };
  const preview = await previewWorkRoute(db, providers, {
    scope: context.scope,
    discordUserId: input.discordUserId,
    input: {
      sourceId: route.sourceId,
      kind: route.kind,
      trigger: route.trigger,
      destinationId: route.destination.channelId,
      ...(route.projectRelation ? { projectRelation: route.projectRelation } : {}),
      tagSync,
    },
  });
  if (preview.kind !== 'ready' || preview.audienceFingerprint !== route.audienceFingerprint)
    return setupReply('The source or destination changed. Start again.');
  const saved = await saveWorkRoute(
    db,
    actor,
    {
      route: {
        ...route,
        state: 'paused',
        revision: route.revision + 1,
        tagSync,
        approvedBy: actor.personId,
        approvedDiscordId: actor.discordUserId,
        approvedGrantVersion: actor.grantVersion,
      },
      expected: route.revision,
    },
    context.clock(),
  );
  if (!saved) return setupReply('The route changed. Open /work routes again.');
  await consumeWorkPreview(
    db,
    { scope: context.scope, id: receipt.id, actorId: input.discordUserId },
    context.clock(),
  );
  return setupReply('Tag mapping saved. Prepare and activate the route from /work routes.');
}

async function reviewTagValues(
  db: Db,
  {
    input,
    receipt,
    p,
    forumId,
    forum,
    field,
    mappings,
    route,
  }: {
    input: WorkPreviewInput;
    receipt: NonNullable<Awaited<ReturnType<typeof ownedReceipt>>>;
    p: Record<string, unknown>;
    forumId: string;
    forum: NonNullable<Awaited<ReturnType<typeof forumForRoute>>>;
    field: { name: string; values: string[] };
    mappings: Record<string, unknown>[];
    route: WorkRoute;
  },
): Promise<WorkPreviewResult> {
  const next = { ...p, forumId, field: field.name, mappings };
  if (
    !(await savePayload(db, receipt.id, input.discordUserId, {
      original: receipt.payload_json,
      payload: next,
    }))
  )
    return setupReply('This setup changed. Start again.');
  if (mappings.length < field.values.length)
    return selectCard(
      receipt.id,
      'route-tags-value',
      `Choose the forum tag for **${taskMarkdown(field.values[mappings.length] ?? '')}**.`,
      forum.tags.map((tag) => ({ label: tag.name, value: tag.id })),
    );
  return {
    kind: 'ready',
    card: workMessage([
      workText(
        `### Review tag mapping\n${mappings.map((mapping) => `${taskMarkdown(String(mapping.value))} → ${taskMarkdown(String(mapping.tagName))}`).join('\n')}\n${route.destination.kind === 'category' ? 'Each project forum needs matching tag names. ' : ''}The route stays paused and needs preparation before activation.`,
      ),
      {
        type: 1,
        components: [
          workButton(
            workCustomId({ id: receipt.id, generation: 1 }, 'route-tags-save'),
            'Save mapping',
          ),
        ],
      },
    ]),
  };
}

async function mapTagValues(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    input,
    receipt,
    p,
    forumId,
    forum,
    source,
    route,
    actor,
  }: {
    input: WorkPreviewInput;
    receipt: NonNullable<Awaited<ReturnType<typeof ownedReceipt>>>;
    p: Record<string, unknown>;
    forumId: string;
    forum: NonNullable<Awaited<ReturnType<typeof forumForRoute>>>;
    source: Extract<Awaited<ReturnType<typeof inspectWorkSourceFields>>, { kind: 'ready' }>;
    route: WorkRoute;
    actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>;
  },
): Promise<WorkPreviewResult> {
  const fieldName = input.intent.action === 'route-tags-field' ? input.intent.value : p.field;
  const field = source.fields.find((item) => item.name === fieldName);
  if (
    !field?.values.length ||
    field.values.length > 25 ||
    field.values.some((value) => value.length > 100)
  )
    return setupReply('The Notion field changed. Start again.');
  const mappings =
    input.intent.action === 'route-tags-field'
      ? []
      : Array.isArray(p.mappings)
        ? p.mappings.map(notionObject)
        : [];
  if (
    mappings.some(
      (mapping, index) =>
        mapping.value !== field.values[index] ||
        typeof mapping.tagName !== 'string' ||
        forum.tags.filter((tag) => tag.name === mapping.tagName).length !== 1,
    )
  )
    return setupReply('The field or tags changed. Start again.');
  if (input.intent.action === 'route-tags-value') {
    const selected = forum.tags.find((tag) => tag.id === input.intent.value);
    const value = field.values[mappings.length];
    if (!selected || !value) return setupReply('Choose an available forum tag.');
    mappings.push({ value, tagName: selected.name });
  }
  if (input.intent.action === 'route-tags-field' || input.intent.action === 'route-tags-value')
    return reviewTagValues(db, { input, receipt, p, forumId, forum, field, mappings, route });
  return saveTagMapping(db, providers, context, { input, receipt, route, actor, mappings, field });
}

async function selectTagField(
  db: Db,
  {
    input,
    receipt,
    p,
    forumId,
    source,
  }: {
    input: WorkPreviewInput;
    receipt: NonNullable<Awaited<ReturnType<typeof ownedReceipt>>>;
    p: Record<string, unknown>;
    forumId: string;
    source: Extract<Awaited<ReturnType<typeof inspectWorkSourceFields>>, { kind: 'ready' }>;
  },
): Promise<WorkPreviewResult> {
  const fields = source.fields.filter(
    (field) =>
      field.name.length <= 100 &&
      field.values.length > 0 &&
      field.values.length <= 25 &&
      field.values.every((value) => value.length <= 100),
  );
  if (!fields.length || fields.length > 25)
    return setupReply('No selectable field with up to 25 values is available.');
  if (
    !(await savePayload(db, receipt.id, input.discordUserId, {
      original: receipt.payload_json,
      payload: {
        ...p,
        forumId,
      },
    }))
  )
    return setupReply('This setup changed. Start again.');
  return selectCard(
    receipt.id,
    'route-tags-field',
    'Choose a Notion field to map to forum tags.',
    fields.map((field) => ({ label: field.name, value: field.name })),
  );
}

function validTagReceipt(
  receipt: Awaited<ReturnType<typeof ownedReceipt>>,
  actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>,
): receipt is NonNullable<Awaited<ReturnType<typeof ownedReceipt>>> {
  return (
    receipt?.state === 'preview' &&
    receipt.actor_person_id === actor.personId &&
    receipt.grant_version === actor.grantVersion
  );
}
function validTagRoute(route: WorkRoute | null, revision: number): route is WorkRoute {
  return (
    route?.state === 'paused' && route.revision === revision && route.destination.kind !== 'text'
  );
}

function hasTagRouteReference(
  p: Record<string, unknown>,
): p is Record<string, unknown> & { routeId: string; revision: number } {
  return typeof p.routeId === 'string' && typeof p.revision === 'number';
}

/** Configure explicit Notion-value-to-tag mappings on a paused route. */
export async function tagMappingSetup(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const actor = await resolveWorkActor(db, context.scope, input.discordUserId);
  if (
    !context.enabled ||
    !actor?.administrator ||
    !(await providers.discord.membership(input.discordUserId, context.scope.guildId))
  )
    return setupReply('Administrator access and enabled project linking are required.');
  const receipt = await ownedReceipt(db, input, context);
  if (!validTagReceipt(receipt, actor))
    return setupReply('This setup has expired. Open /work routes again.');
  const p = notionObject(JSON.parse(receipt.payload_json) as unknown);
  if (!hasTagRouteReference(p)) return setupReply('This route control is unavailable.');
  const route = await readWorkRoute(db, context.scope, p.routeId);
  if (!validTagRoute(route, p.revision))
    return setupReply('Pause the forum route and open /work routes again.');
  if (input.intent.action === 'route-tags-start')
    return startTagMapping(db, providers, context, { input, actor, route, p });
  if (p.intent !== 'tag-setup') return setupReply('This tag setup is unavailable.');
  const forumId = input.intent.action === 'route-tags-forum' ? input.intent.value : p.forumId;
  if (typeof forumId !== 'string') return setupReply('Choose an example forum.');
  const forum = await forumForRoute(providers, route, forumId);
  const source = await inspectWorkSourceFields(db, providers, {
    scope: context.scope,
    discordUserId: input.discordUserId,
    sourceId: route.sourceId,
  });
  if (!forum || source.kind !== 'ready')
    return setupReply('The source, forum, tags or approved audience changed. Start again.');
  if (input.intent.action === 'route-tags-forum')
    return selectTagField(db, { input, receipt, p, forumId, source });
  return mapTagValues(db, providers, context, {
    input,
    receipt,
    p,
    forumId,
    forum,
    source,
    route,
    actor,
  });
}
