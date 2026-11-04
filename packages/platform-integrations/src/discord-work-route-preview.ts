import type { Db } from '@lasvegasfortransit/platform-storage/db';
import type { WorkScope } from '@lasvegasfortransit/platform-storage/discord-work-types';
import {
  enqueueWorkOperation,
  readWorkOperation,
  consumeWorkPreview,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import {
  readWorkRoute,
  saveWorkRoute,
  type WorkRoute,
} from '@lasvegasfortransit/platform-storage/discord-work-routes';
import { readWorkSource, resolveWorkActor } from './discord-work-authority';
import { notionObject, notionProperty } from './notion-task-types';
import type { WorkProviders } from './discord-work-actions';

interface RoutePreviewInput {
  sourceId: string;
  kind: 'project' | 'event';
  trigger: { property: string; values: string[] };
  destinationId: string;
  projectRelation?: { property: string; projectSourceId: string };
  tagSync?: WorkRoute['tagSync'];
}

type RouteApprovalInput = RoutePreviewInput & {
  id: string;
  expectedRevision: number;
  tagIds?: string[];
};
type RoutePreview =
  | {
      kind: 'ready';
      actorPersonId: string;
      sourceTitle: string;
      audienceFingerprint: string;
      destination: { kind: 'category' | 'forum' | 'text'; channelId: string };
      tagRequired: boolean;
      availableTags: { id: string; name: string }[];
    }
  | { kind: 'unavailable'; reason: string };
const unavailable = (reason: string): Extract<RoutePreview, { kind: 'unavailable' }> => ({
  kind: 'unavailable',
  reason,
});
const canonicalId = (id: string) => id.replaceAll('-', '').toLowerCase();

/** Project authorization and provisioning use the configured task source's project database. */
export async function projectRouteSourceMatches(
  db: Db,
  scope: WorkScope,
  taskSourceId: string,
  projectSourceId: string,
): Promise<boolean> {
  const source = await readWorkSource(db, taskSourceId, scope);
  return !!source && canonicalId(source.policy.projectsSourceId) === canonicalId(projectSourceId);
}

function sourceTagProblem(
  source: Record<string, unknown>,
  input: RoutePreviewInput,
): RoutePreview | null {
  if (input.tagSync) {
    const selected = notionProperty(source, input.tagSync.property);
    if (selected.type !== 'status' && selected.type !== 'select')
      return unavailable('tag_field_unavailable');
    const tagOptions = notionObject(selected[selected.type]).options;
    if (
      !Array.isArray(tagOptions) ||
      !Array.isArray(input.tagSync.mappings) ||
      !input.tagSync.mappings.length ||
      input.tagSync.mappings.some(
        (mapping) => !tagOptions.some((option) => notionObject(option).name === mapping.value),
      )
    )
      return unavailable('tag_field_unavailable');
  }
  return null;
}

function sourceRelationProblem(
  source: Record<string, unknown>,
  input: RoutePreviewInput,
): RoutePreview | null {
  if (input.projectRelation) {
    const relation = notionProperty(source, input.projectRelation.property);
    if (
      input.kind !== 'event' ||
      relation.type !== 'relation' ||
      canonicalId(
        typeof notionObject(relation.relation).data_source_id === 'string'
          ? (notionObject(relation.relation).data_source_id as string)
          : '',
      ) !== canonicalId(input.projectRelation.projectSourceId)
    )
      return unavailable('project_relation_unavailable');
  }
  return null;
}

function sourceTriggerProblem(
  source: Record<string, unknown>,
  input: RoutePreviewInput,
): RoutePreview | null {
  const field = notionObject(notionObject(source.properties)[input.trigger.property]);
  if (field.type !== 'status' && field.type !== 'select')
    return unavailable('trigger_property_unavailable');
  const options = notionObject(field[field.type]).options;
  if (
    !Array.isArray(options) ||
    !input.trigger.values.length ||
    input.trigger.values.some(
      (value) => !options.some((option) => notionObject(option).name === value),
    )
  )
    return unavailable('trigger_option_unavailable');
  return null;
}

function sourceProblem(
  source: Record<string, unknown>,
  input: RoutePreviewInput,
): RoutePreview | null {
  if (
    source.object !== 'data_source' ||
    typeof source.id !== 'string' ||
    canonicalId(source.id) !== canonicalId(input.sourceId) ||
    source.archived === true ||
    source.in_trash === true
  )
    return unavailable('source_unavailable');
  return (
    sourceTriggerProblem(source, input) ??
    sourceRelationProblem(source, input) ??
    sourceTagProblem(source, input)
  );
}

type RouteDestination = Awaited<ReturnType<WorkProviders['discord']['inspectDestination']>>;
async function destinationKindProblem(
  discord: WorkProviders['discord'],
  dest: RouteDestination,
  input: RoutePreviewInput,
): Promise<RoutePreview | null> {
  if (input.kind === 'project') {
    if (!dest.isCategory) return unavailable('project_category_required');
    if (!dest.canManageChannels) return unavailable('manage_channels_required');
    if (!(await discord.communityEnabled())) return unavailable('forum_unavailable');
  } else if (input.projectRelation) {
    if (!dest.isCategory) return unavailable('project_category_required');
  } else if (dest.isCategory || dest.destination.kind === 'thread')
    return unavailable('event_channel_required');
  else if (!dest.canSend || (dest.destination.kind === 'text' && !dest.canCreateThreads))
    return unavailable('thread_permission_required');
  return null;
}

async function destinationProblem(
  discord: WorkProviders['discord'],
  dest: RouteDestination,
  input: RoutePreviewInput,
): Promise<RoutePreview | null> {
  if (!dest.canRead || dest.archived || dest.locked) return unavailable('destination_unavailable');
  if (
    input.tagSync &&
    !dest.isCategory &&
    (dest.destination.kind !== 'forum' ||
      input.tagSync.mappings.some(
        (mapping) => dest.tags.filter((tag) => tag.name === mapping.tagName).length !== 1,
      ))
  )
    return unavailable('tag_mapping_unavailable');
  const kindError = await destinationKindProblem(discord, dest, input);
  if (kindError) return kindError;
  if (dest.requiredTag && !dest.tags.length) return unavailable('required_tag_unavailable');
  return null;
}

/** Read-only validation; approval and a fresh validation are required before saving a route. */
export async function previewWorkRoute(
  db: Db,
  providers: WorkProviders,
  {
    scope,
    discordUserId,
    input,
  }: { scope: WorkScope; discordUserId: string; input: RoutePreviewInput },
): Promise<RoutePreview> {
  try {
    const actor = await resolveWorkActor(db, scope, discordUserId);
    if (
      !actor?.administrator ||
      !(await providers.discord.membership(discordUserId, scope.guildId))
    )
      return unavailable('administrator_required');
    const source = notionObject(await providers.notion.readDataSource(input.sourceId));
    const sourceError = sourceProblem(source, input);
    if (sourceError) return sourceError;
    const dest = await providers.discord.inspectDestination(input.destinationId);
    const destinationError = await destinationProblem(providers.discord, dest, input);
    if (destinationError) return destinationError;
    const title = Array.isArray(source.title)
      ? source.title
          .map((part) => {
            const text = notionObject(part).plain_text;
            return typeof text === 'string' ? text : '';
          })
          .join('')
          .trim()
          .slice(0, 100)
      : '';
    return {
      kind: 'ready',
      actorPersonId: actor.personId,
      sourceTitle: title || 'Notion source',
      audienceFingerprint: dest.audienceFingerprint,
      destination: {
        kind: dest.isCategory ? 'category' : (dest.destination.kind as 'forum' | 'text'),
        channelId: dest.destination.channelId,
      },
      tagRequired: dest.requiredTag,
      availableTags: dest.tags,
    };
  } catch {
    return unavailable('connection_unavailable');
  }
}

function tagSelectionProblem(
  input: RouteApprovalInput,
  preview: Extract<RoutePreview, { kind: 'ready' }>,
): Extract<RoutePreview, { kind: 'unavailable' }> | null {
  const tagIds = input.tagIds ?? [];
  if (preview.tagRequired && !tagIds.length) return unavailable('tag_selection_required');
  if (
    tagIds.length > 5 ||
    new Set(tagIds).size !== tagIds.length ||
    (preview.destination.kind !== 'forum' && tagIds.length > 0) ||
    tagIds.some((tag) => !preview.availableTags.some((candidate) => candidate.id === tag))
  )
    return unavailable('invalid_forum_tag');
  return null;
}

/** Persist a short-lived, actor-bound preview; it does not enable or create anything. */
export async function startWorkRouteApproval(
  db: Db,
  providers: WorkProviders,
  {
    scope,
    discordUserId,
    input,
    now,
  }: { scope: WorkScope; discordUserId: string; input: RouteApprovalInput; now: Date },
): Promise<
  | { kind: 'ready'; receiptId: string; preview: Extract<RoutePreview, { kind: 'ready' }> }
  | { kind: 'unavailable'; reason: string }
> {
  const preview = await previewWorkRoute(db, providers, {
    scope: scope,
    discordUserId: discordUserId,
    input: input,
  });
  if (preview.kind !== 'ready') return preview;
  const tagError = tagSelectionProblem(input, preview);
  if (tagError) return tagError;
  const actor = await resolveWorkActor(db, scope, discordUserId);
  if (!actor?.administrator || actor.personId !== preview.actorPersonId)
    return unavailable('administrator_required');
  if (!input.id || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
    return unavailable('invalid_route');
  const receiptId = crypto.randomUUID();
  const result = await enqueueWorkOperation(
    db,
    {
      id: receiptId,
      scope,
      homeId: null,
      conversationId: null,
      generation: 1,
      kind: 'provision',
      sourceKey: `route-preview:${receiptId}`,
      actorPersonId: actor.personId,
      actorDiscordId: discordUserId,
      grantVersion: actor.grantVersion,
      originalAuthorId: discordUserId,
      preview: true,
      payload: { intent: 'route', input, preview },
    },
    now,
  );
  if (result !== 'queued') return unavailable('preview_unavailable');
  return { kind: 'ready', receiptId, preview };
}

function approvedRoute(
  input: RouteApprovalInput,
  preview: Extract<RoutePreview, { kind: 'ready' }>,
  actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>,
  scope: WorkScope,
): WorkRoute {
  return {
    id: input.id,
    scope,
    sourceId: input.sourceId,
    sourceTitle: preview.sourceTitle,
    kind: input.kind,
    state: 'paused',
    revision: input.expectedRevision + 1,
    trigger: input.trigger,
    destination: preview.destination,
    ...(input.projectRelation ? { projectRelation: input.projectRelation } : {}),
    ...(input.tagSync ? { tagSync: input.tagSync } : {}),
    tagIds: input.tagIds ?? [],
    approvedBy: actor.personId,
    approvedDiscordId: actor.discordUserId,
    approvedGrantVersion: actor.grantVersion,
    audienceFingerprint: preview.audienceFingerprint,
  };
}

async function needsTagMappingReview(db: Db, scope: WorkScope, input: RouteApprovalInput) {
  if (input.expectedRevision <= 0 || input.tagSync) return false;
  const existing = await readWorkRoute(db, scope, input.id);
  return !!existing?.tagSync;
}

export async function confirmWorkRouteApproval(
  db: Db,
  providers: WorkProviders,
  {
    scope,
    discordUserId,
    receiptId,
    now,
  }: { scope: WorkScope; discordUserId: string; receiptId: string; now: Date },
): Promise<{ kind: 'saved' } | { kind: 'unavailable'; reason: string }> {
  const receipt = await readWorkOperation(db, scope, receiptId);
  if (
    receipt?.state !== 'preview' ||
    receipt.actor_discord_id !== discordUserId ||
    !receipt.expires_at ||
    receipt.expires_at <= now.toISOString()
  )
    return unavailable('preview_expired');
  const payload = notionObject(JSON.parse(receipt.payload_json) as unknown);
  if (payload.intent !== 'route') return unavailable('preview_unavailable');
  const input = payload.input as RouteApprovalInput;
  const previous = payload.preview as Extract<RoutePreview, { kind: 'ready' }>;
  const preview = await previewWorkRoute(db, providers, {
    scope: scope,
    discordUserId: discordUserId,
    input: input,
  });
  if (preview.kind !== 'ready') return preview;
  const actor = await resolveWorkActor(db, scope, discordUserId);
  if (
    !actor?.administrator ||
    actor.personId !== receipt.actor_person_id ||
    actor.grantVersion !== receipt.grant_version
  )
    return unavailable('administrator_required');
  if (JSON.stringify(preview) !== JSON.stringify(previous)) return unavailable('preview_changed');
  if (await needsTagMappingReview(db, scope, input))
    return unavailable('tag_mapping_review_required');
  const saved = await saveWorkRoute(
    db,
    actor,
    { route: approvedRoute(input, preview, actor, scope), expected: input.expectedRevision },
    now,
  );
  if (!saved) return unavailable('route_conflict');
  await consumeWorkPreview(db, { scope, id: receiptId, actorId: discordUserId }, now);
  return { kind: 'saved' };
}
