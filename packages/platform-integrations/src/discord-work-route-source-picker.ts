import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { discoverWorkSources, inspectWorkSourceFields } from './discord-work-source-discovery';
import { projectRouteSourceMatches } from './discord-work-route-preview';
import { notionObject } from './notion-task-types';
import { setupReply } from './discord-work-setup-common';
import type { ownedReceipt } from './discord-work-setup-common';
import { workMessage, workText, workCustomId, workButton } from './discord-work-cards';
import { savePayload } from './discord-work-route-setup-common';
import type { DiscordTaskComponent } from './notion-task-cards';
import type { WorkEffectContext, WorkProviders } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';

export function picker(
  id: string,
  action: string,
  heading: string,
  {
    options,
    more,
    skip,
    maxChoices,
  }: {
    options: { label: string; value: string }[];
    more?: string | undefined;
    skip?: string | undefined;
    maxChoices?: number | undefined;
  },
): WorkPreviewResult {
  if (!options.length)
    return setupReply('No matching choices are available. Check the connection and try again.');
  const components: DiscordTaskComponent[] = [
    workText(heading),
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: workCustomId({ id, generation: 1 }, action),
          placeholder: maxChoices && maxChoices > 1 ? 'Choose one or more' : 'Choose one',
          options: options.slice(0, 25),
          ...(maxChoices
            ? { min_values: 1, max_values: Math.min(maxChoices, options.length, 25) }
            : {}),
        },
      ],
    },
  ];
  if (more)
    components.push({
      type: 1,
      components: [workButton(workCustomId({ id, generation: 1 }, more), 'More choices')],
    });
  if (skip)
    components.push({
      type: 1,
      components: [workButton(workCustomId({ id, generation: 1 }, skip), 'Continue without a tag')],
    });
  return { kind: 'ready', card: workMessage(components) };
}
export function sourcePicker(id: string, p: Record<string, unknown>): WorkPreviewResult {
  const sources = Array.isArray(p.sources) ? p.sources.map(notionObject) : [];
  return picker(id, 'route-source', 'Choose a Notion source for this route.', {
    options: sources.map((s) => ({ label: String(s.title).slice(0, 100), value: String(s.id) })),
    more: p.nextCursor ? 'route-more' : undefined,
  });
}
function choicePicker(id: string, p: Record<string, unknown>): WorkPreviewResult {
  const choices = Array.isArray(p.choices) ? p.choices.map(notionObject) : [];
  const offset = typeof p.offset === 'number' ? p.offset : 0;
  return picker(id, 'route-choice', 'Choose eligible values from one status field.', {
    maxChoices: 25,
    options: choices.slice(offset, offset + 25).map((c, index) => ({
      label: `${String(c.field)}: ${String(c.value)}`.slice(0, 100),
      value: String(offset + index),
    })),
    more: offset + 25 < choices.length ? 'route-next' : undefined,
  });
}
async function selectSingleRouteSource(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    input,
    receipt,
    p,
  }: {
    input: WorkPreviewInput;
    receipt: NonNullable<Awaited<ReturnType<typeof ownedReceipt>>>;
    p: Record<string, unknown>;
  },
): Promise<WorkPreviewResult> {
  const sources = Array.isArray(p.sources) ? p.sources.map(notionObject) : [];
  if (!sources.some((s) => s.id === input.intent.value))
    return setupReply('Choose a source from the list.');
  const sourceId = String(input.intent.value);
  if (
    p.kind === 'project' &&
    !(await projectRouteSourceMatches(db, context.scope, context.taskSourceId, sourceId))
  )
    return setupReply(
      'This source is not the configured projects database. Choose that database or update the workspace configuration.',
    );
  const fields = await inspectWorkSourceFields(db, providers, {
    scope: context.scope,
    discordUserId: input.discordUserId,
    sourceId: sourceId,
  });
  if (fields.kind !== 'ready') return setupReply('The selected source is unavailable.');
  const choices = fields.fields.flatMap((field) =>
    field.values.map((value) => ({ field: field.name, value })),
  );
  const foundTitle = sources.find((source) => source.id === sourceId)?.title;
  const sourceTitle = typeof foundTitle === 'string' ? foundTitle : 'Notion source';
  const next = { ...p, sourceId, sourceTitle, choices, offset: 0 };
  return (await savePayload(db, receipt.id, input.discordUserId, {
    original: receipt.payload_json,
    payload: next,
  }))
    ? choicePicker(receipt.id, next)
    : setupReply('This setup changed. Start again.');
}

export async function selectRouteSource(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    input,
    receipt,
    p,
  }: {
    input: WorkPreviewInput;
    receipt: NonNullable<Awaited<ReturnType<typeof ownedReceipt>>>;
    p: Record<string, unknown>;
  },
): Promise<WorkPreviewResult | null> {
  if (input.intent.action === 'route-more') {
    if (typeof p.nextCursor !== 'string') return setupReply('There are no more sources.');
    const page = await discoverWorkSources(db, providers, {
      scope: context.scope,
      discordUserId: input.discordUserId,
      input: {
        query: '',
        cursor: p.nextCursor,
      },
    });
    if (page.kind !== 'ready') return setupReply('Notion sources are unavailable.');
    const next = { ...p, sources: page.sources, nextCursor: page.nextCursor };
    return (await savePayload(db, receipt.id, input.discordUserId, {
      original: receipt.payload_json,
      payload: next,
    }))
      ? sourcePicker(receipt.id, next)
      : setupReply('This setup changed. Start again.');
  }
  if (input.intent.action === 'route-source')
    return selectSingleRouteSource(db, providers, context, { input, receipt, p });
  if (input.intent.action === 'route-next') {
    const next = { ...p, offset: (typeof p.offset === 'number' ? p.offset : 0) + 25 };
    return (await savePayload(db, receipt.id, input.discordUserId, {
      original: receipt.payload_json,
      payload: next,
    }))
      ? choicePicker(receipt.id, next)
      : setupReply('This setup changed. Start again.');
  }
  return null;
}
