import { object, discordId, DiscordApiFailure } from './discord-types';
import type { DiscordHttp } from './discord-http';
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
async function discoverPost(
  input: DiscoveryInput,
  context: { destinationId: string; found: WorkDiscovery; botId: string },
): Promise<WorkDiscovery | null> {
  const request = (path: string) =>
    input.http.request(path, { authorization: input.authorization, responseSize: 'work-history' });
  const response = object(await request(`/guilds/${input.guildId}/threads/active`));
  const threads = Array.isArray(response.threads) ? response.threads.map(object) : [];
  for (const thread of threads
    .filter(
      (t) =>
        t.parent_id === context.destinationId && t.guild_id === input.guildId && discordId(t.id),
    )
    .slice(0, 8)) {
    const m = object(await request(`/channels/${String(thread.id)}/messages/${String(thread.id)}`));
    if (
      m.id === thread.id &&
      m.channel_id === thread.id &&
      object(m.author).id === context.botId &&
      marked(m.components, input.operationId)
    )
      return {
        ...context.found,
        threadId: String(thread.id),
        starterMessageId: String(thread.id),
        cardChannelId: String(thread.id),
      };
  }
  return context.found.forumId ? context.found : null;
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
