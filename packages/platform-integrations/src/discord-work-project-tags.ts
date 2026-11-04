import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readProjectHome,
  setProjectEventForumTags,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { workScopeKey } from '@lasvegasfortransit/platform-storage/discord-work-types';
import { consumeWorkPreview } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { resolveWorkActor } from './discord-work-authority';
import { setupReceipt, ownedReceipt, setupReply } from './discord-work-setup-common';
import { workMessage, workText, workCustomId, workButton } from './discord-work-cards';
import { notionObject } from './notion-task-types';
import type { WorkProviders, WorkEffectContext } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';

type ProjectHome = NonNullable<Awaited<ReturnType<typeof readProjectHome>>>;
type Forum = Awaited<ReturnType<WorkProviders['discord']['inspectDestination']>>;
function forumMatchesHome(forum: Forum, home: ProjectHome): boolean {
  return (
    forum.destination.kind === 'forum' &&
    forum.destination.parentId === home.destination.parentId &&
    forum.canRead &&
    forum.canSend &&
    forum.audienceFingerprint === home.audienceFingerprint
  );
}
function validTagSelection(forum: Forum, selected: string[]): boolean {
  return (
    (!forum.requiredTag || selected.length > 0) &&
    selected.length <= 5 &&
    new Set(selected).size === selected.length &&
    selected.every((id) => forum.tags.some((tag) => tag.id === id))
  );
}

function projectTagsCard(
  home: ProjectHome,
  forum: Forum,
  forumId: string,
  receiptId: string,
): WorkPreviewResult {
  const options = forum.tags.slice(0, 25).map((tag) => ({
    label: tag.name.slice(0, 100),
    value: tag.id,
    default:
      home.eventForumTags?.forumId === forumId && home.eventForumTags.tagIds.includes(tag.id),
  }));
  if (!options.length && forum.requiredTag)
    return setupReply('This forum requires a tag but has no available tags.');
  const components: Parameters<typeof workMessage>[0] = [
    workText(
      `### Event tags for <#${forumId}>\nChoose up to five tags to apply to future event posts in this project forum. Existing posts are not changed.`,
    ),
  ];
  if (options.length)
    components.push({
      type: 1,
      components: [
        {
          type: 3,
          custom_id: workCustomId({ id: receiptId, generation: 1 }, 'project-tag-save'),
          placeholder: 'Choose event tags',
          min_values: 1,
          max_values: Math.min(5, options.length),
          options,
        },
      ],
    });
  if (!forum.requiredTag)
    components.push({
      type: 1,
      components: [
        workButton(
          workCustomId({ id: receiptId, generation: 1 }, 'project-tag-clear'),
          'Use no tags',
        ),
      ],
    });
  return { kind: 'ready', card: workMessage(components) };
}

async function showProjectEventTags(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    actor,
    input,
  }: { actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>; input: WorkPreviewInput },
): Promise<WorkPreviewResult> {
  const forumId = input.intent.destinationId;
  if (!forumId) return setupReply('Choose an existing project forum.');
  const rows = await db
    .prepare(
      "SELECT id FROM discord_project_homes WHERE scope_key=? AND destination_id=? AND state='active' AND coalesce(json_extract(data_json,'$.kind'),'project')='project' LIMIT 2",
    )
    .bind(workScopeKey(context.scope), forumId)
    .all<{ id: string }>();
  const [row] = rows.results;
  if (rows.results.length !== 1 || !row)
    return setupReply('This forum is not linked to exactly one active project.');
  const home = await readProjectHome(db, context.scope, row.id);
  const forum = await providers.discord.inspectDestination(forumId);
  if (home?.destination.kind !== 'forum' || !forumMatchesHome(forum, home))
    return setupReply('The forum or its approved audience is unavailable.');
  const receipt = await setupReceipt(
    db,
    {
      request: input,
      actor,
      payload: {
        intent: 'project-event-tags',
        homeId: home.id,
        generation: home.generation,
        forumId,
        audience: home.audienceFingerprint,
        previousTags: home.eventForumTags ?? null,
      },
    },
    context,
  );
  return projectTagsCard(home, forum, forumId, receipt.id);
}

function homeMatchesPreview(
  home: ProjectHome | null,
  payload: Record<string, unknown>,
): home is ProjectHome {
  return (
    home?.state === 'active' &&
    home.generation === payload.generation &&
    home.destination.kind === 'forum' &&
    home.destination.channelId === payload.forumId &&
    home.audienceFingerprint === payload.audience &&
    JSON.stringify(home.eventForumTags ?? null) === JSON.stringify(payload.previousTags)
  );
}

async function saveProjectEventTags(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    actor,
    input,
  }: { actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>; input: WorkPreviewInput },
): Promise<WorkPreviewResult> {
  const receipt = await ownedReceipt(db, input, context);
  if (
    receipt?.state !== 'preview' ||
    receipt.actor_person_id !== actor.personId ||
    receipt.grant_version !== actor.grantVersion
  )
    return setupReply('This control has expired. Run /work project-event-tags again.');
  const payload = notionObject(JSON.parse(receipt.payload_json) as unknown);
  if (
    payload.intent !== 'project-event-tags' ||
    typeof payload.homeId !== 'string' ||
    typeof payload.forumId !== 'string'
  )
    return setupReply('This control is unavailable.');
  const home = await readProjectHome(db, context.scope, payload.homeId);
  if (!homeMatchesPreview(home, payload))
    return setupReply('This project changed. Run /work project-event-tags again.');
  const forum = await providers.discord.inspectDestination(payload.forumId);
  const selected = input.intent.action === 'project-tag-clear' ? [] : (input.intent.values ?? []);
  if (!forumMatchesHome(forum, home) || !validTagSelection(forum, selected))
    return setupReply('The forum, audience or tags changed. Run /work project-event-tags again.');
  if (
    !(await setProjectEventForumTags(
      db,
      { personId: actor.personId },
      { home, tagIds: selected },
      context.clock(),
    ))
  )
    return setupReply('This project changed. Run /work project-event-tags again.');
  await consumeWorkPreview(
    db,
    { scope: context.scope, id: receipt.id, actorId: actor.discordUserId },
    context.clock(),
  );
  return setupReply(
    `Event tags saved for <#${payload.forumId}>. Use /work routes and Retry checks for held events.`,
  );
}

/** Choose the tags used when a route creates event posts in one approved project forum. */
export async function projectEventTags(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const actor = await resolveWorkActor(db, context.scope, input.discordUserId);
  if (!actor?.administrator) return setupReply('Administrator access is required.');
  if (!context.enabled) return setupReply('Project linking is disabled.');
  if (input.intent.action === 'project-event-tags')
    return showProjectEventTags(db, providers, context, { actor, input });
  return saveProjectEventTags(db, providers, context, { actor, input });
}
