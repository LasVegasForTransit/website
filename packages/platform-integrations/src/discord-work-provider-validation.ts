import { object, discordId } from './discord-types';

export function validTagSet(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 5 &&
    value.every(discordId) &&
    new Set(value).size === value.length
  );
}
export function validPinnedThread(
  parent: Record<string, unknown>,
  thread: Record<string, unknown>,
  forumId: string,
): boolean {
  return (
    parent.type === 15 &&
    thread.type === 11 &&
    thread.parent_id === forumId &&
    object(thread.thread_metadata).archived === false &&
    Number.isSafeInteger(thread.flags) &&
    Number(thread.flags) >= 0
  );
}
export function validPinnedResponse(
  updated: Record<string, unknown>,
  expected: { threadId: string; guildId: string; forumId: string },
): boolean {
  return (
    updated.id === expected.threadId &&
    updated.guild_id === expected.guildId &&
    updated.parent_id === expected.forumId &&
    Number.isSafeInteger(updated.flags) &&
    (BigInt(Number(updated.flags)) & 2n) !== 0n
  );
}

export function sameTags(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}
export function updatedTagsMatch(
  updated: Record<string, unknown>,
  input: { threadId: string; forumId: string; tags: string[] },
  guildId: string,
): boolean {
  return (
    updated.id === input.threadId &&
    updated.guild_id === guildId &&
    updated.type === 11 &&
    updated.parent_id === input.forumId &&
    Array.isArray(updated.applied_tags) &&
    updated.applied_tags.every(discordId) &&
    sameTags(updated.applied_tags, input.tags)
  );
}
