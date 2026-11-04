import { DiscordHttp } from './discord-http';
import { DiscordTaskClient } from './notion-task-discord';
import { object, discordId, DiscordApiFailure, type DiscordOptions } from './discord-types';
import {
  workRoles,
  workOverwrites,
  workPermissions,
  workAudience,
} from './discord-work-permissions';
import type { DiscordTaskMessage } from './notion-task-cards';
import type { WorkDestination, WorkMessage } from './discord-work-types';
export interface DestinationInspection {
  createdName?: string | undefined;
  destination: WorkDestination;
  isCategory?: boolean;
  privateThread?: boolean | undefined;
  audienceFingerprint: string;
  archived: boolean;
  locked: boolean;
  canRead: boolean;
  canSend: boolean;
  canCreateThreads: boolean;
  canManageChannels: boolean;
  requiredTag: boolean;
  tags: { id: string; name: string }[];
}
export interface CreatedConversation {
  createdName?: string | undefined;
  threadId: string;
  starterMessageId: string;
  cardChannelId?: string;
}
export interface ConversationCreateInput {
  destination: DestinationInspection;
  title: string;
  card: DiscordTaskMessage;
  operationId: string;
  tagIds: string[];
  onStarter?: (created: CreatedConversation) => Promise<void>;
}
function channelKind(type: unknown): WorkDestination['kind'] {
  if (type === 0) return 'text';
  if (type === 15) return 'forum';
  if ([10, 11, 12].includes(Number(type))) return 'thread';
  throw new Error('unsupported_channel_type');
}
function message(value: unknown, channelId: string): WorkMessage {
  const row = object(value),
    author = object(row.author);
  if (
    !discordId(row.id) ||
    row.channel_id !== channelId ||
    !discordId(author.id) ||
    typeof row.timestamp !== 'string' ||
    !Number.isFinite(Date.parse(row.timestamp))
  )
    throw new DiscordApiFailure('invalid_response');
  const text = typeof row.content === 'string' ? row.content : '';
  return {
    id: row.id,
    channelId,
    authorId: author.id,
    authorName:
      typeof author.global_name === 'string'
        ? author.global_name
        : typeof author.username === 'string'
          ? author.username
          : 'Discord participant',
    createdAt: new Date(row.timestamp).toISOString(),
    text,
    bot: author.bot === true,
    webhook: typeof row.webhook_id === 'string',
    system: ![0, 19].includes(Number(row.type)),
    contentAvailable: typeof row.content === 'string',
    attachmentOnly: !text && Array.isArray(row.attachments) && row.attachments.length > 0,
  };
}
function createdRouteMatches(
  created: Record<string, unknown>,
  expected: { guildId: string; type: number; parentId: string | null },
): boolean {
  return (
    created.guild_id === expected.guildId &&
    created.type === expected.type &&
    (created.parent_id ?? null) === expected.parentId
  );
}

function routeDestinationName(input: {
  name: string;
  operationId: string;
  kind: 'category' | 'text' | 'forum';
  parentId?: string;
}): string {
  const name = input.name.trim();
  if (!name || name.length > 100 || !/^[\w-]{1,64}$/.test(input.operationId))
    throw new DiscordApiFailure('invalid_response');
  if (input.kind === 'category' && input.parentId) throw new Error('category_cannot_have_parent');
  return name;
}

export class DiscordWorkProviderBase {
  protected readonly http: DiscordHttp;
  protected readonly authorization: string;
  private readonly members: DiscordTaskClient;
  constructor(
    protected readonly config: DiscordOptions & {
      guildId: string;
      applicationId: string;
      botToken: string;
      allowWrites?: boolean;
    },
  ) {
    if (!discordId(config.guildId) || !discordId(config.applicationId) || !config.botToken)
      throw new DiscordApiFailure('not_configured');
    this.http = new DiscordHttp(config);
    this.authorization = `Bot ${config.botToken}`;
    this.members = new DiscordTaskClient(config);
  }
  membership(userId: string, guildId: string) {
    return this.members.membership(userId, guildId);
  }
  async communityEnabled(): Promise<boolean> {
    const guild = object(
      await this.http.request(`/guilds/${this.config.guildId}`, {
        authorization: this.authorization,
      }),
    );
    if (guild.id !== this.config.guildId || !Array.isArray(guild.features))
      throw new DiscordApiFailure('invalid_response');
    return guild.features.includes('COMMUNITY');
  }
  protected write() {
    if (!this.config.allowWrites) throw new Error('work_sending_disabled');
  }
  async readPlanningName(channelId: string): Promise<string> {
    const channel = await this.channel(channelId);
    if (typeof channel.name !== 'string') throw new DiscordApiFailure('invalid_response');
    return channel.name;
  }
  async pinWorkMessage(channelId: string, messageId: string): Promise<void> {
    this.write();
    if (!discordId(messageId)) throw new DiscordApiFailure('invalid_response');
    await this.channel(channelId);
    await this.http.request(`/channels/${channelId}/messages/pins/${messageId}`, {
      method: 'PUT',
      authorization: this.authorization,
      reason: 'Pin the project overview',
    });
  }
  protected async channel(id: string) {
    if (!discordId(id)) throw new DiscordApiFailure('invalid_response');
    const value = object(
      await this.http.request(`/channels/${id}`, { authorization: this.authorization }),
    );
    if (value.id !== id || value.guild_id !== this.config.guildId)
      throw new DiscordApiFailure('permission_denied');
    return value;
  }
  async inspectGuildPlacement(): Promise<{
    canManageChannels: boolean;
    audienceFingerprint: string;
  }> {
    const self = object(
      await this.http.request('/users/@me', { authorization: this.authorization }),
    );
    if (!discordId(self.id)) throw new DiscordApiFailure('invalid_response');
    const roles = workRoles(
      await this.http.request(`/guilds/${this.config.guildId}/roles`, {
        authorization: this.authorization,
        responseSize: 'guild-roles',
      }),
    );
    const member = object(
      await this.http.request(`/guilds/${this.config.guildId}/members/${self.id}`, {
        authorization: this.authorization,
      }),
    );
    if (!Array.isArray(member.roles) || !member.roles.every(discordId))
      throw new DiscordApiFailure('invalid_response');
    const permissions = workPermissions({
      guildId: this.config.guildId,
      userId: self.id,
      memberRoles: member.roles,
      roles,
      overwrites: [],
    });
    return {
      canManageChannels: Boolean(permissions & (1n << 4n)),
      audienceFingerprint: await workAudience(roles, [], null),
    };
  }
  async inspectDestination(id: string): Promise<DestinationInspection> {
    const row = await this.channel(id),
      kind = row.type === 4 ? 'forum' : channelKind(row.type);
    const parent = kind === 'thread' ? await this.channel(String(row.parent_id)) : row;
    const self = object(
      await this.http.request('/users/@me', { authorization: this.authorization }),
    );
    if (!discordId(self.id)) throw new DiscordApiFailure('invalid_response');
    const roles = workRoles(
      await this.http.request(`/guilds/${this.config.guildId}/roles`, {
        authorization: this.authorization,
        responseSize: 'guild-roles',
      }),
    );
    const member = object(
      await this.http.request(`/guilds/${this.config.guildId}/members/${self.id}`, {
        authorization: this.authorization,
      }),
    );
    if (!Array.isArray(member.roles) || !member.roles.every(discordId))
      throw new DiscordApiFailure('invalid_response');
    const overwrites = workOverwrites(parent.permission_overwrites);
    const permissions = workPermissions({
      guildId: this.config.guildId,
      userId: self.id,
      memberRoles: member.roles,
      roles,
      overwrites,
    });
    const has = (bit: bigint) => Boolean(permissions & (1n << bit));
    const tags = Array.isArray(row.available_tags)
      ? row.available_tags
          .map((v) => object(v))
          .filter((v) => discordId(v.id) && typeof v.name === 'string')
          .map((v) => ({ id: String(v.id), name: String(v.name) }))
      : [];
    return {
      isCategory: row.type === 4,
      privateThread: row.type === 12,
      destination: {
        kind,
        channelId: id,
        parentId: discordId(row.parent_id) ? row.parent_id : null,
      },
      audienceFingerprint: await workAudience(roles, overwrites, String(parent.id)),
      archived: object(row.thread_metadata ?? {}).archived === true,
      locked: object(row.thread_metadata ?? {}).locked === true,
      canRead: has(10n) && has(16n),
      canSend: has(10n) && has(kind === 'thread' ? 38n : 11n),
      canCreateThreads: has(35n),
      canManageChannels: has(4n),
      requiredTag: (Number(row.flags) & 16) !== 0,
      tags,
    };
  }
  async messageContentAvailable(): Promise<boolean> {
    const app = object(
      await this.http.request('/oauth2/applications/@me', { authorization: this.authorization }),
    );
    if (app.id !== this.config.applicationId) throw new DiscordApiFailure('invalid_response');
    return typeof app.flags === 'number' && Boolean(app.flags & ((1 << 18) | (1 << 19)));
  }
  async readMessages(
    channelId: string,
    query: { after?: string; before?: string; limit: number },
  ): Promise<WorkMessage[]> {
    await this.channel(channelId);
    const params = new URLSearchParams({ limit: String(Math.min(25, Math.max(1, query.limit))) });
    if (query.after) params.set('after', query.after);
    if (query.before) params.set('before', query.before);
    const value = await this.http.request(`/channels/${channelId}/messages?${params.toString()}`, {
      authorization: this.authorization,
      responseSize: 'work-history',
    });
    if (!Array.isArray(value) || value.length > 25) throw new DiscordApiFailure('invalid_response');
    return value.map((v) => message(v, channelId));
  }
  async createProjectForum(input: {
    categoryId: string;
    name: string;
    projectUrl: string;
    operationId: string;
  }): Promise<WorkDestination & { createdName?: string }> {
    this.write();
    const category = await this.channel(input.categoryId);
    if (category.type !== 4) throw new Error('category_required');
    const guild = object(
      await this.http.request(`/guilds/${this.config.guildId}`, {
        authorization: this.authorization,
      }),
    );
    if (!Array.isArray(guild.features) || !guild.features.includes('COMMUNITY'))
      throw new Error('forum_unavailable');
    const created = object(
      await this.http.request(`/guilds/${this.config.guildId}/channels`, {
        method: 'POST',
        authorization: this.authorization,
        workCreation: true,
        jsonBody: {
          type: 15,
          name: input.name.slice(0, 100),
          parent_id: input.categoryId,
          topic: `Project plan: ${input.projectUrl}\nLVBT work reference: ${input.operationId}`,
        },
      }),
    );
    if (
      !discordId(created.id) ||
      created.guild_id !== this.config.guildId ||
      created.type !== 15 ||
      created.parent_id !== input.categoryId
    )
      throw new DiscordApiFailure('invalid_response');
    return {
      kind: 'forum',
      channelId: created.id,
      parentId: input.categoryId,
      ...(typeof created.name === 'string' ? { createdName: created.name } : {}),
    };
  }
  /** Create a route destination only after the caller has durably approved and claimed the request. */
  async createRouteDestination(input: {
    kind: 'category' | 'text' | 'forum';
    name: string;
    parentId?: string;
    operationId: string;
  }): Promise<{ channelId: string; parentId: string | null }> {
    this.write();
    const name = routeDestinationName(input);
    if (input.parentId && (await this.channel(input.parentId)).type !== 4)
      throw new Error('category_required');
    if (input.kind === 'forum' && !(await this.communityEnabled()))
      throw new Error('forum_unavailable');
    const type = input.kind === 'category' ? 4 : input.kind === 'forum' ? 15 : 0;
    const created = object(
      await this.http.request(`/guilds/${this.config.guildId}/channels`, {
        method: 'POST',
        authorization: this.authorization,
        workCreation: true,
        reason: `LVBT route setup ${input.operationId}`,
        jsonBody: {
          name,
          type,
          ...(input.parentId ? { parent_id: input.parentId } : {}),
          ...(type === 4 ? {} : { topic: `LVBT route setup: ${input.operationId}` }),
        },
      }),
    );
    const parentId = input.parentId ?? null;
    if (
      !discordId(created.id) ||
      !createdRouteMatches(created, { guildId: this.config.guildId, type, parentId })
    )
      throw new DiscordApiFailure('invalid_response');
    return { channelId: created.id, parentId };
  }
}
