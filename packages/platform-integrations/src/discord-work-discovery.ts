import { object, discordId, DiscordApiFailure } from './discord-types';
import type { DiscordHttp } from './discord-http';
import { notionWorkId, notionWorkUrl } from './discord-work-input';
export interface WorkDiscovery {
  forumId?: string;
  threadId?: string;
  starterMessageId?: string;
  cardChannelId?: string;
  starterOnly?: boolean;
}
interface DiscoveryInput {
  http: DiscordHttp;
  authorization: string;
  guildId: string;
  destinationId: string;
  operationId: string;
  createForum: boolean;
  isTask: boolean;
}
function marked(value: unknown, operationId: string): boolean {
  if (Array.isArray(value)) return value.some((v) => marked(v, operationId));
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (typeof row.url === 'string') {
    try {
      if (new URL(row.url).searchParams.get('lvbt_work_create') === operationId) return true;
    } catch {
      /* No marker in this field. */
    }
  }
  return Object.values(row).some((v) => marked(v, operationId));
}
async function discoverForum(input: DiscoveryInput): Promise<string | null> {
  const channels = await input.http.request(`/guilds/${input.guildId}/channels`, {
    authorization: input.authorization,
    responseSize: 'work-history',
  });
  if (!Array.isArray(channels)) throw new DiscordApiFailure('invalid_response');
  const forums = channels
    .map(object)
    .filter(
      (c) =>
        c.guild_id === input.guildId &&
        c.parent_id === input.destinationId &&
        c.type === 15 &&
        typeof c.topic === 'string' &&
        c.topic.endsWith(`LVBT work reference: ${input.operationId}`),
    );
  const [forum] = forums;
  return forums.length === 1 && discordId(forum?.id) ? forum.id : null;
}
async function includeArchived(
  request: (path: string) => Promise<unknown>,
  input: { destinationId: string; guildId: string },
  candidates: Record<string, unknown>[],
): Promise<boolean> {
  const archived = object(
    await request(`/channels/${input.destinationId}/threads/archived/public?limit=100`),
  );
  if (!Array.isArray(archived.threads) || typeof archived.has_more !== 'boolean')
    throw new DiscordApiFailure('invalid_response');
  if (archived.has_more) return false;
  for (const value of archived.threads) {
    const thread = object(value);
    if (thread.parent_id !== input.destinationId || !discordId(thread.id))
      throw new DiscordApiFailure('invalid_response');
    if (thread.guild_id !== undefined && thread.guild_id !== input.guildId)
      throw new DiscordApiFailure('invalid_response');
    if (!candidates.some((candidate) => candidate.id === thread.id)) candidates.push(thread);
  }
  return candidates.length <= 8;
}
async function discoverPost(
  input: DiscoveryInput,
  context: { destinationId: string; found: WorkDiscovery; botId: string },
): Promise<WorkDiscovery | null> {
  const request = (path: string) =>
    input.http.request(path, { authorization: input.authorization, responseSize: 'work-history' });
  const response = object(await request(`/guilds/${input.guildId}/threads/active`));
  if (!Array.isArray(response.threads)) throw new DiscordApiFailure('invalid_response');
  const candidates = response.threads
    .map(object)
    .filter(
      (t) =>
        t.parent_id === context.destinationId && t.guild_id === input.guildId && discordId(t.id),
    );
  // An incomplete scan cannot establish that the marked post is unique.
  if (candidates.length > 8) return null;
  if (
    !(await includeArchived(
      request,
      { destinationId: context.destinationId, guildId: input.guildId },
      candidates,
    ))
  )
    return null;
  let foundPost: WorkDiscovery | null = null;
  for (const thread of candidates) {
    const m = object(await request(`/channels/${String(thread.id)}/messages/${String(thread.id)}`));
    if (
      m.id === thread.id &&
      m.channel_id === thread.id &&
      object(m.author).id === context.botId &&
      marked(m.components, input.operationId)
    ) {
      if (foundPost) return null;
      foundPost = {
        ...context.found,
        threadId: String(thread.id),
        starterMessageId: String(thread.id),
        cardChannelId: String(thread.id),
      };
    }
  }
  return foundPost ?? (context.found.forumId ? context.found : null);
}
/** Bounded, positive evidence only. A missing result never authorizes another post. */
export async function discoverDiscordWork(input: DiscoveryInput): Promise<WorkDiscovery | null> {
  const { http, authorization, guildId, operationId } = input;
  const request = (path: string) =>
    http.request(path, { authorization, responseSize: 'work-history' });
  const self = object(await request('/users/@me'));
  if (!discordId(self.id)) throw new DiscordApiFailure('invalid_response');
  let destinationId = input.destinationId;
  const found: WorkDiscovery = {};
  if (input.createForum) {
    const forumId = await discoverForum(input);
    if (!forumId) return null;
    destinationId = forumId;
    found.forumId = forumId;
  }
  const d = object(await request(`/channels/${destinationId}`));
  if (d.id !== destinationId || d.guild_id !== guildId)
    throw new DiscordApiFailure('permission_denied');
  const ownMarker = (v: unknown) => {
    const m = object(v);
    return discordId(m.id) && object(m.author).id === self.id && marked(m.components, operationId);
  };
  if (d.type === 15) return discoverPost(input, { destinationId, found, botId: self.id });
  const messages = await request(`/channels/${destinationId}/messages?limit=25`);
  if (!Array.isArray(messages)) throw new DiscordApiFailure('invalid_response');
  const matches = messages.filter(ownMarker).map(object);
  if (matches.length !== 1) return null;
  const id = String(matches[0]?.id);
  if (d.type === 0 && input.isTask) {
    // Discord permits only one thread per starter; its ID is the message ID.
    return {
      ...found,
      threadId: id,
      starterMessageId: id,
      cardChannelId: destinationId,
      starterOnly: true,
    };
  }
  return { ...found, threadId: destinationId, starterMessageId: id, cardChannelId: destinationId };
}

function containsNotionPage(content: string, pageId: string): boolean {
  const urls = content.match(/https:\/\/[^\s<>]+/g) ?? [];
  return urls.some((url) => notionWorkUrl(url.replace(/[),.!?]+$/, '')) === pageId);
}

/** Find only a uniquely linked event post. A missing result never proves that no post exists. */
export async function discoverLinkedEvent(input: {
  http: DiscordHttp;
  authorization: string;
  guildId: string;
  forumId: string;
  pageId: string;
}): Promise<string | null> {
  const pageId = notionWorkId(input.pageId);
  if (!pageId || !discordId(input.forumId)) throw new DiscordApiFailure('invalid_response');
  const request = (path: string) =>
    input.http.request(path, { authorization: input.authorization, responseSize: 'work-history' });
  const parent = object(await request(`/channels/${input.forumId}`));
  if (parent.id !== input.forumId || parent.guild_id !== input.guildId || parent.type !== 15)
    throw new DiscordApiFailure('permission_denied');
  const active = object(await request(`/guilds/${input.guildId}/threads/active`));
  if (!Array.isArray(active.threads)) throw new DiscordApiFailure('invalid_response');
  const candidates = active.threads
    .map(object)
    .filter(
      (thread) =>
        thread.parent_id === input.forumId &&
        thread.guild_id === input.guildId &&
        discordId(thread.id),
    );
  if (
    candidates.length > 8 ||
    !(await includeArchived(
      request,
      { destinationId: input.forumId, guildId: input.guildId },
      candidates,
    ))
  )
    return null;
  let match: string | null = null;
  for (const thread of candidates) {
    const id = String(thread.id);
    const message = object(await request(`/channels/${id}/messages/${id}`));
    if (message.id !== id || message.channel_id !== id || typeof message.content !== 'string')
      throw new DiscordApiFailure('invalid_response');
    if (containsNotionPage(message.content, pageId)) {
      if (match) return null;
      match = id;
    }
  }
  return match;
}
