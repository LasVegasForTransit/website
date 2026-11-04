import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { readWorkSource } from './discord-work-authority';
import { inspectProjectRelations } from './discord-work-source-discovery';
import { startWorkRouteApproval, previewWorkRoute } from './discord-work-route-preview';
import { notionObject } from './notion-task-types';
import { savePayload } from './discord-work-route-setup-common';
import { picker } from './discord-work-route-source-picker';
import { taskMarkdown } from './notion-task-cards';
import { setupReply } from './discord-work-setup-common';
import type { ownedReceipt } from './discord-work-setup-common';
import { workMessage, workText, workCustomId, workButton } from './discord-work-cards';
import type { WorkEffectContext, WorkProviders } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';

type RouteProposal = Parameters<typeof startWorkRouteApproval>[2]['input'];
type RouteApproval = Extract<Awaited<ReturnType<typeof startWorkRouteApproval>>, { kind: 'ready' }>;
function routeReviewCard(
  context: WorkEffectContext,
  {
    input,
    p,
    proposal,
    selected,
    approval,
  }: {
    input: WorkPreviewInput;
    p: Record<string, unknown>;
    proposal: RouteProposal;
    selected: { field: string; values: string[] };
    approval: RouteApproval;
  },
): WorkPreviewResult {
  const selectedTags = approval.preview.availableTags.filter((tag) =>
    (input.intent.values ?? [input.intent.value]).includes(tag.id),
  );
  const tagLine =
    input.intent.action === 'route-tag' && selectedTags.length
      ? `\nForum tags: ${selectedTags.map((tag) => taskMarkdown(tag.name)).join(', ')}`
      : '';
  const sourceTitle = typeof p.sourceTitle === 'string' ? p.sourceTitle : 'Notion source';
  const relation = Array.isArray(p.relations)
    ? notionObject(
        p.relations.find((r) => notionObject(r).id === proposal.projectRelation?.property),
      ).name
    : null;
  const relationName = typeof relation === 'string' ? relation : 'Project';
  return {
    kind: 'ready',
    card: workMessage([
      workText(
        `### Review route\nSource: ${taskMarkdown(sourceTitle)}\n${taskMarkdown(selected.field)}: ${selected.values.map(taskMarkdown).join(', ')}\n${proposal.projectRelation ? `Project relation: ${taskMarkdown(relationName)}\nProject forums in category: ` : 'Destination: '}<#${proposal.destinationId}>${tagLine}\nThe destination audience may differ from Notion access. This route will be saved paused; prepare and activate it from /work routes.`,
      ),
      {
        type: 1,
        components: [
          workButton(
            workCustomId({ id: approval.receiptId, generation: 1 }, 'route-approve'),
            'Save paused route',
            !context.enabled,
          ),
        ],
      },
    ]),
  };
}

interface ReviewState {
  input: WorkPreviewInput;
  receipt: NonNullable<Awaited<ReturnType<typeof ownedReceipt>>>;
  p: Record<string, unknown>;
  indexes: number[];
  proposal: RouteProposal;
}
async function chooseProjectRelation(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  { input, receipt, p, indexes, proposal }: ReviewState,
): Promise<WorkPreviewResult> {
  const source = await readWorkSource(db, context.taskSourceId, context.scope);
  if (!source) return setupReply('The configured projects source is unavailable.');
  const relations = await inspectProjectRelations(db, providers, {
    scope: context.scope,
    discordUserId: input.discordUserId,
    sourceId: proposal.sourceId,
    projectSourceId: source.policy.projectsSourceId,
  });
  if (!relations)
    return setupReply(
      'The Notion source could not be checked. Confirm the integration has source access and try again.',
    );
  if (!relations.length)
    return setupReply(
      'Add a relation from this event source to the configured projects source in Notion, share it with the integration, then start setup again.',
    );
  const next = {
    ...p,
    selectedChoices: indexes,
    projectSourceId: source.policy.projectsSourceId,
    relations,
  };
  if (
    !(await savePayload(db, receipt.id, input.discordUserId, {
      original: receipt.payload_json,
      payload: next,
    }))
  )
    return setupReply('This setup changed. Start again.');
  return picker(
    receipt.id,
    'route-relation',
    'Choose the relation that identifies an event’s project.',
    {
      options: relations.map((relation) => ({
        label: relation.name.slice(0, 100),
        value: relation.id,
      })),
    },
  );
}

async function chooseRouteTags(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  { input, receipt, p, indexes, proposal }: ReviewState,
): Promise<WorkPreviewResult | null> {
  const preview = await previewWorkRoute(db, providers, {
    scope: context.scope,
    discordUserId: input.discordUserId,
    input: proposal,
  });
  if (preview.kind !== 'ready')
    return setupReply('The source or destination cannot be used. Check access and permissions.');
  if (preview.destination.kind === 'forum' && preview.availableTags.length > 0) {
    const next = { ...p, selectedChoices: indexes, allowSkipTag: !preview.tagRequired };
    if (
      !(await savePayload(db, receipt.id, input.discordUserId, {
        original: receipt.payload_json,
        payload: next,
      }))
    )
      return setupReply('This setup changed. Start again.');
    return picker(
      receipt.id,
      'route-tag',
      preview.tagRequired
        ? 'Choose one to five forum tags.'
        : 'Choose up to five forum tags, or continue without one.',
      {
        options: preview.availableTags.map((tag) => ({
          label: tag.name.slice(0, 100),
          value: tag.id,
        })),
        more: undefined,
        skip: preview.tagRequired ? undefined : 'route-skip-tag',
        maxChoices: 5,
      },
    );
  }

  return null;
}

function selectedRouteChoices(input: WorkPreviewInput, p: Record<string, unknown>) {
  const choices = Array.isArray(p.choices) ? p.choices.map(notionObject) : [];
  const raw =
    input.intent.action === 'route-choice'
      ? (input.intent.values ?? (input.intent.value ? [input.intent.value] : []))
      : Array.isArray(p.selectedChoices)
        ? p.selectedChoices
        : [p.selectedChoice];
  const indexes = raw.map(Number);
  const offset = typeof p.offset === 'number' ? p.offset : 0;
  const selected = indexes.map((index) => choices[index]);
  if (
    !indexes.length ||
    indexes.length > 25 ||
    new Set(indexes).size !== indexes.length ||
    indexes.some(
      (index) => !Number.isSafeInteger(index) || index < offset || index >= offset + 25,
    ) ||
    selected.some(
      (choice) => !choice || typeof choice.field !== 'string' || typeof choice.value !== 'string',
    ) ||
    selected.some((choice) => choice?.field !== selected[0]?.field)
  )
    return null;
  const field = String(selected[0]?.field);
  const values = selected.map((choice) => String(choice?.value));
  return { indexes, field, values };
}

function buildRouteProposal(
  input: WorkPreviewInput,
  receipt: NonNullable<Awaited<ReturnType<typeof ownedReceipt>>>,
  p: Record<string, unknown>,
) {
  if (
    typeof p.sourceId !== 'string' ||
    typeof p.destinationId !== 'string' ||
    !['project', 'event'].includes(String(p.kind))
  )
    return null;
  const selection = selectedRouteChoices(input, p);
  if (!selection) return null;
  const { indexes, field, values } = selection;
  const proposal = {
    id: typeof p.routeId === 'string' ? p.routeId : receipt.id,
    expectedRevision: typeof p.revision === 'number' ? p.revision : 0,
    sourceId: p.sourceId,
    kind: p.kind as 'project' | 'event',
    trigger: { property: field, values },
    destinationId: p.destinationId,
    ...(input.intent.action === 'route-relation' &&
    typeof p.projectSourceId === 'string' &&
    typeof input.intent.value === 'string'
      ? { projectRelation: { property: input.intent.value, projectSourceId: p.projectSourceId } }
      : {}),
  };
  return { proposal, indexes, selected: { field, values } };
}

function projectRelationMissing(
  input: WorkPreviewInput,
  p: Record<string, unknown>,
  proposal: RouteProposal,
): boolean {
  return (
    p.projectMode === true &&
    (input.intent.action !== 'route-relation' ||
      !Array.isArray(p.relations) ||
      !p.relations.map(notionObject).some((relation) => relation.id === input.intent.value) ||
      !proposal.projectRelation)
  );
}

export async function reviewRouteSetup(
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
  const built = buildRouteProposal(input, receipt, p);
  if (!built) return setupReply('Choose a status from the list.');
  const { proposal, indexes, selected } = built;
  if (input.intent.action === 'route-choice' && p.projectMode === true)
    return chooseProjectRelation(db, providers, context, { input, receipt, p, indexes, proposal });
  if (projectRelationMissing(input, p, proposal))
    return setupReply('Choose the project relation from the list.');
  if (input.intent.action === 'route-choice') {
    const tags = await chooseRouteTags(db, providers, context, {
      input,
      receipt,
      p,
      indexes,
      proposal,
    });
    if (tags) return tags;
  }
  if (input.intent.action === 'route-skip-tag' && p.allowSkipTag !== true)
    return setupReply('Choose the required forum tag.');
  const approval = await startWorkRouteApproval(db, providers, {
    scope: context.scope,
    discordUserId: input.discordUserId,
    input: {
      ...proposal,
      ...(input.intent.action === 'route-tag'
        ? { tagIds: input.intent.values ?? [input.intent.value ?? ''] }
        : {}),
    },
    now: context.clock(),
  });
  if (approval.kind !== 'ready')
    return setupReply(
      'The route could not be prepared. Check the source, destination and permissions.',
    );
  return routeReviewCard(context, {
    input,
    p,
    proposal,
    selected,
    approval,
  });
}
