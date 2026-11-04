import { DiscordApiFailure, object } from './discord-types';

export class NameSyncPreDispatchFailure extends Error {
  constructor(readonly original: unknown) {
    super('Name update was not dispatched');
  }
}

export interface PlanningNameUpdate {
  channelId: string;
  parentId: string | null;
  kind: 'forum' | 'thread';
  expectedName: string;
  name: string;
  beforeWrite?: (() => Promise<void>) | undefined;
}

export function validatePlanningName(channel: Record<string, unknown>, input: PlanningNameUpdate) {
  if (
    !input.name.trim() ||
    input.name.length > 100 ||
    channel.type !== (input.kind === 'forum' ? 15 : 11) ||
    (channel.parent_id ?? null) !== input.parentId ||
    typeof channel.name !== 'string'
  )
    throw new DiscordApiFailure('invalid_response');
  if (input.kind === 'thread') {
    const metadata = object(channel.thread_metadata);
    if (metadata.archived !== false) throw new Error('planning_post_archived');
    if (metadata.locked !== false) throw new Error('planning_post_locked');
  }
  if (channel.name !== input.expectedName) throw new Error('planning_name_changed');
}

export function validPlanningNameResult(
  channel: Record<string, unknown>,
  input: PlanningNameUpdate,
  guildId: string,
): boolean {
  return (
    channel.id === input.channelId &&
    channel.guild_id === guildId &&
    channel.type === (input.kind === 'forum' ? 15 : 11) &&
    (channel.parent_id ?? null) === input.parentId &&
    channel.name === input.name
  );
}
