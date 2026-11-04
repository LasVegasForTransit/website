import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  enqueueWorkOperation,
  consumeWorkPreview,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { workScopeKey } from '@lasvegasfortransit/platform-storage/discord-work-types';
import { resolveWorkActor } from './discord-work-authority';
import { discordId } from './discord-types';
import { notionObject } from './notion-task-types';
import { taskMarkdown } from './notion-task-cards';
import { setupReply, setupReceipt, ownedReceipt } from './discord-work-setup-common';
import { workMessage, workText, workButton, workCustomId } from './discord-work-cards';
import type { WorkEffectContext, WorkProviders } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';
import type { WorkActor } from './discord-work-types';

interface SetupContext {
  db: Db;
  providers: WorkProviders;
  input: WorkPreviewInput;
  context: WorkEffectContext;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

async function listDestinations(
  { db, context }: SetupContext,
  actor: WorkActor,
): Promise<WorkPreviewResult> {
  const rows = await db
    .prepare(
      "SELECT payload_json,state,result_json FROM discord_work_operations WHERE scope_key=? AND actor_person_id=? AND kind='provision' AND source_key LIKE 'destination:%' AND json_extract(payload_json,'$.intent')='destination' ORDER BY created_at DESC LIMIT 10",
    )
    .bind(workScopeKey(context.scope), actor.personId)
    .all<{ payload_json: string; state: string; result_json: string | null }>();
  if (!rows.results.length) return setupReply('No destination creation requests yet.');
  const lines = rows.results.map((row) => {
    const payload = notionObject(JSON.parse(row.payload_json) as unknown);
    const result = notionObject(row.result_json ? (JSON.parse(row.result_json) as unknown) : {});
    const status =
      row.state === 'confirmed' && discordId(result.channelId)
        ? `Created: <#${result.channelId}>. ${payload.kind === 'category' ? 'Select it with /work route-project or use it for a new events destination.' : 'Select it with /work route-event.'}`
        : row.state === 'held'
          ? 'Needs review; do not submit another creation request.'
          : row.state === 'failed' || row.state === 'superseded'
            ? 'Could not create; check access and review the request again.'
            : 'Waiting for creation.';
    return `**${taskMarkdown(typeof payload.name === 'string' ? payload.name : 'Destination')}** · ${status}`;
  });
  return setupReply(`### Destination requests\n${lines.join('\n')}`);
}

function validDestinationPayload(p: Record<string, unknown>): boolean {
  return (
    p.intent === 'destination' &&
    (p.kind === 'text' || p.kind === 'forum' || p.kind === 'category') &&
    typeof p.name === 'string' &&
    (p.kind === 'category' || discordId(p.parentId)) &&
    typeof p.audienceFingerprint === 'string'
  );
}

async function confirmationParentCurrent(
  providers: WorkProviders,
  p: Record<string, unknown>,
): Promise<boolean> {
  const parent =
    p.kind === 'category'
      ? await providers.discord.inspectGuildPlacement()
      : await providers.discord.inspectDestination(String(p.parentId));
  if (
    p.kind !== 'category' &&
    (!('isCategory' in parent) || !parent.isCategory || !('canRead' in parent) || !parent.canRead)
  )
    return false;
  if (!parent.canManageChannels || parent.audienceFingerprint !== p.audienceFingerprint)
    return false;
  return p.kind !== 'forum' || providers.discord.communityEnabled();
}

async function confirmDestination(
  { db, providers, input, context }: SetupContext,
  actor: WorkActor,
): Promise<WorkPreviewResult> {
  if (!context.enabled) return setupReply('Shared work is disabled.');
  const receipt = await ownedReceipt(db, input, context);
  if (receipt?.actor_person_id !== actor.personId || receipt.grant_version !== actor.grantVersion)
    return setupReply('This review has expired. Start again.');
  if (receipt.state === 'superseded' && receipt.reason === 'preview_consumed')
    return setupReply('Request already queued. Check /work destinations.');
  if (receipt.state !== 'preview') return setupReply('This review has expired. Start again.');
  const p = notionObject(JSON.parse(receipt.payload_json) as unknown);
  if (!validDestinationPayload(p)) return setupReply('This review is unavailable.');
  if (!(await confirmationParentCurrent(providers, p)))
    return setupReply(
      'The category or its permissions changed. Start again and review the destination.',
    );
  const queued = await enqueueWorkOperation(
    db,
    {
      id: `dest-${receipt.id}`,
      scope: context.scope,
      homeId: null,
      conversationId: null,
      generation: 1,
      kind: 'provision',
      sourceKey: `destination:${receipt.id}`,
      actorPersonId: actor.personId,
      actorDiscordId: actor.discordUserId,
      grantVersion: actor.grantVersion,
      originalAuthorId: actor.discordUserId,
      payload: p,
    },
    context.clock(),
  );
  if (queued === 'stale') return setupReply('The request could not be queued.');
  await consumeWorkPreview(
    db,
    { scope: context.scope, id: receipt.id, actorId: input.discordUserId },
    context.clock(),
  );
  return setupReply('Creation queued. Check /work destinations for the result.');
}

async function previewParent(providers: WorkProviders, kind: string, parentId: unknown) {
  const parent =
    kind === 'category'
      ? await providers.discord.inspectGuildPlacement()
      : await providers.discord.inspectDestination(String(parentId));
  if (
    !parent.canManageChannels ||
    (kind !== 'category' &&
      (!('isCategory' in parent) ||
        !parent.isCategory ||
        !('canRead' in parent) ||
        !parent.canRead))
  )
    return null;
  return parent;
}

async function previewDestination(
  { db, providers, input, context }: SetupContext,
  actor: WorkActor,
): Promise<WorkPreviewResult> {
  const kind =
    input.intent.action === 'create-category'
      ? 'category'
      : input.intent.action === 'create-event-forum'
        ? 'forum'
        : 'text';
  const name = input.intent.name?.trim(),
    parentId = input.intent.destinationId;
  if (
    !name ||
    name.length > 100 ||
    hasControlCharacter(name) ||
    (kind !== 'category' && !discordId(parentId))
  )
    return setupReply('Choose a valid name and, for a channel, a category.');
  const parent = await previewParent(providers, kind, parentId);
  if (!parent)
    return setupReply('The bot needs access and Manage Channels in the selected location.');
  if (kind === 'forum' && !(await providers.discord.communityEnabled()))
    return setupReply('Forum channels require Community to be enabled on this server.');
  const receipt = await setupReceipt(
    db,
    {
      request: input,
      actor,
      payload: {
        intent: 'destination',
        kind,
        name,
        parentId,
        audienceFingerprint: parent.audienceFingerprint,
      },
    },
    context,
  );
  return {
    kind: 'ready',
    card: workMessage([
      workText(
        kind === 'category'
          ? `### Review new category\nName: ${taskMarkdown(name)}\nThe category uses server-wide permissions. Review who can see the server before creating it.`
          : `### Review new ${kind === 'forum' ? 'forum' : 'text channel'}\nName: ${taskMarkdown(name)}\nCategory: <#${parentId}>\nThe new channel uses the category’s permissions. Review who can see that category before creating it.`,
      ),
      {
        type: 1,
        components: [
          workButton(
            workCustomId({ id: receipt.id, generation: 1 }, 'dest-confirm'),
            'Create destination',
            !context.enabled,
          ),
        ],
      },
    ]),
  };
}

export async function destinationSetup(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const actor = await resolveWorkActor(db, context.scope, input.discordUserId);
  if (!actor?.administrator) return setupReply('Administrator access is required.');
  const setup = { db, providers, input, context };
  if (input.intent.action === 'destinations') return listDestinations(setup, actor);
  if (input.intent.action === 'dest-confirm') return confirmDestination(setup, actor);
  return previewDestination(setup, actor);
}
