import { t } from '@lasvegasfortransit/platform-core/messages';
import { isDiscordId } from '@lasvegasfortransit/platform-core/discord-identity';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readTaskCheckinSource,
  setTaskCheckinConsent,
  readTaskCheckinConsent,
  type TaskCheckinSource,
} from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import { taskCheckinActor } from '@lasvegasfortransit/platform-storage/notion-task-cards';
import {
  parseTaskCustomId,
  renderTaskSetup,
  renderTaskStopControls,
  type TaskCustomId,
} from './notion-task-cards';
import { readTaskCheckinPolicy, type TaskCheckinPolicy } from './notion-task-policy';
import { handleTaskCardAction } from './notion-task-card-actions';
import { taskNotice, taskPrivateMessage } from './notion-task-replies';
import { notionObject } from './notion-task-types';
import type { TaskCheckinInteractionContext } from './notion-task-runtime';

async function consentReply(
  db: Db,
  input: {
    source: TaskCheckinSource;
    custom: Extract<TaskCustomId, { kind: 'setup' }>;
    personId: string;
    discordUserId: string;
    interactionId: string;
  },
  now: Date,
): Promise<Response> {
  const { source, custom, personId, discordUserId, interactionId } = input;
  if (custom.state === 'active' && custom.revision !== source.revision)
    return taskNotice(t('taskCheckins.settingsChanged'));
  await setTaskCheckinConsent(
    db,
    {
      sourceId: source.id,
      personId,
      discordUserId,
      interactionId,
      state: custom.state,
      policyRevision: source.revision,
    },
    now,
  );
  const current = await readTaskCheckinConsent(db, {
    sourceId: source.id,
    personId,
    discordUserId,
  });
  if (
    !current ||
    (current.state === 'active' && current.policy_revision !== current.current_policy_revision)
  )
    return taskNotice(t('taskCheckins.settingsChanged'));
  const labels = {
    active: t('taskCheckins.optedIn'),
    paused: t('taskCheckins.paused'),
    opted_out: t('taskCheckins.optedOut'),
  } as const;
  return taskNotice(labels[current.state]);
}
function actorId(interaction: Record<string, unknown>): unknown {
  return interaction.guild_id
    ? notionObject(notionObject(interaction.member).user).id
    : notionObject(interaction.user).id;
}
interface TaskRequest {
  interaction: Record<string, unknown>;
  command: boolean;
  custom: TaskCustomId | null;
  discordUserId: string;
  interactionId: string;
}
function recognized(interaction: Record<string, unknown>) {
  const data = notionObject(interaction.data);
  const command = interaction.type === 2 && data.name === 'checkins';
  const custom = parseTaskCustomId(data.custom_id);
  return command || custom ? { command, custom } : null;
}
function validScope(
  interaction: Record<string, unknown>,
  request: { command: boolean; custom: TaskCustomId | null },
  context: TaskCheckinInteractionContext,
): boolean {
  if (interaction.application_id !== context.applicationId) return false;
  if (request.command && interaction.guild_id !== context.guildId) return false;
  if (interaction.guild_id && interaction.guild_id !== context.guildId) return false;
  return (
    request.custom?.kind !== 'setup' ||
    (request.custom.sourceId === context.sourceId && interaction.type === 3)
  );
}
function taskRequest(
  payload: unknown,
  context: TaskCheckinInteractionContext,
): TaskRequest | Response | null {
  const interaction = notionObject(payload),
    request = recognized(interaction);
  if (!request) return null;
  if (!validScope(interaction, request, context)) return new Response(null, { status: 403 });
  const discordUserId = actorId(interaction);
  if (!isDiscordId(discordUserId) || !isDiscordId(interaction.id))
    return new Response(null, { status: 400 });
  return { interaction, ...request, discordUserId, interactionId: interaction.id };
}
function availablePolicy(
  policy: TaskCheckinPolicy | null,
  context: TaskCheckinInteractionContext,
  personId: string,
): policy is TaskCheckinPolicy {
  return (
    !context.preferencesOnly &&
    policy?.guildId === context.guildId &&
    policy.cohortPersonIds.includes(personId)
  );
}
async function linkedInteraction(
  db: Db,
  request: TaskRequest,
  source: TaskCheckinSource,
  context: TaskCheckinInteractionContext,
): Promise<Response> {
  const { custom, command, discordUserId, interactionId, interaction } = request;
  const actor = await taskCheckinActor(db, discordUserId);
  if (!actor)
    return command ? taskNotice(t('taskCheckins.linkFirst')) : new Response(null, { status: 403 });
  const consent =
    custom?.kind === 'setup'
      ? { source, custom, personId: actor.person_id, discordUserId, interactionId }
      : null;
  if (consent && consent.custom.state !== 'active') return consentReply(db, consent, new Date());
  const policy = readTaskCheckinPolicy(source.policy_json);
  if (!availablePolicy(policy, context, actor.person_id))
    return command
      ? taskPrivateMessage(
          renderTaskStopControls({ sourceId: source.id, revision: source.revision }),
        )
      : taskNotice(t('taskCheckins.preferencesUnavailable'));
  if (command)
    return taskPrivateMessage(
      renderTaskSetup({ sourceId: source.id, revision: source.revision, policy }),
    );
  if (consent) return consentReply(db, consent, new Date());
  if (custom?.kind === 'task')
    return handleTaskCardAction(
      db,
      { interaction, custom, policy, source, discordUserId },
      new Date(),
    );
  return new Response(null, { status: 400 });
}
/** Accept only a signed Discord payload. This handler never performs provider writes inline. */
export async function handleTaskInteraction(
  db: Db,
  payload: unknown,
  context: TaskCheckinInteractionContext,
): Promise<Response | null> {
  const request = taskRequest(payload, context);
  if (!request || request instanceof Response) return request;
  if (context.preferencesOnly && request.custom?.kind === 'task')
    return new Response(null, { status: 404 });
  try {
    const source = await readTaskCheckinSource(db, context.sourceId);
    if (!source) return taskNotice(t('taskCheckins.unavailable'));
    return await linkedInteraction(db, request, source, context);
  } catch {
    return taskNotice(t('taskCheckins.unavailable'), 503);
  }
}
