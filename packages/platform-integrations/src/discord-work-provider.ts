import { discoverDiscordWork } from './discord-work-discovery';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
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
  destination: WorkDestination;
  isCategory?: boolean;
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
function requireCreation(input: ConversationCreateInput): void {
  const d = input.destination;
  if (d.isCategory) throw new Error('category_is_not_a_conversation');
  if (d.destination.kind === 'thread') throw new Error('nested_threads_unavailable');
  if (!d.canSend || d.locked || d.archived) throw new DiscordApiFailure('permission_denied');
  if (d.requiredTag && !input.tagIds.length) throw new Error('forum_tag_required');
  if (input.tagIds.some((id) => !d.tags.some((t) => t.id === id)))
    throw new Error('invalid_forum_tag');
}
export class DiscordWorkClient {
  private readonly http: DiscordHttp;
  private readonly authorization: string;
  private readonly members: DiscordTaskClient;
  constructor(
    private readonly config: DiscordOptions & {
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
  private write() {
    if (!this.config.allowWrites) throw new Error('work_sending_disabled');
  }
  private async channel(id: string) {
    if (!discordId(id)) throw new DiscordApiFailure('invalid_response');
    const value = object(
      await this.http.request(`/channels/${id}`, { authorization: this.authorization }),
    );
    if (value.id !== id || value.guild_id !== this.config.guildId)
      throw new DiscordApiFailure('permission_denied');
    return value;
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
  }): Promise<WorkDestination> {
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
    if (!discordId(created.id) || created.guild_id !== this.config.guildId || created.type !== 15)
      throw new DiscordApiFailure('invalid_response');
    return { kind: 'forum', channelId: created.id, parentId: input.categoryId };
  }
  async createTaskConversation(input: ConversationCreateInput): Promise<CreatedConversation> {
    this.write();
    const d = input.destination;
    requireCreation(input);
    const channelId = d.destination.channelId;
    if (d.destination.kind === 'forum') {
      const row = object(
        await this.http.request(`/channels/${channelId}/threads`, {
          method: 'POST',
          authorization: this.authorization,
          workCreation: true,
          jsonBody: {
            name: input.title.slice(0, 100),
            auto_archive_duration: 10080,
            applied_tags: input.tagIds,
            message: { ...input.card, allowed_mentions: { parse: [] } },
          },
        }),
      );
      if (
        !discordId(row.id) ||
        row.parent_id !== channelId ||
        row.guild_id !== this.config.guildId ||
        object(row.message).id !== row.id
      )
        throw new DiscordApiFailure('invalid_response');
      return { threadId: row.id, starterMessageId: row.id };
    }
    if (!d.canCreateThreads) throw new DiscordApiFailure('permission_denied');
    const starter = await this.sendCard(channelId, input.card, input.operationId);
    await input.onStarter?.({
      threadId: starter,
      starterMessageId: starter,
      cardChannelId: channelId,
    });
    const row = object(
      await this.http.request(`/channels/${channelId}/messages/${starter}/threads`, {
        method: 'POST',
        authorization: this.authorization,
        workCreation: true,
        jsonBody: { name: input.title.slice(0, 100), auto_archive_duration: 10080 },
      }),
    );
    if (row.id !== starter || row.parent_id !== channelId || row.guild_id !== this.config.guildId)
      throw new DiscordApiFailure('invalid_response');
    return { threadId: starter, starterMessageId: starter, cardChannelId: channelId };
  }
  discoverWork(input: {
    destinationId: string;
    operationId: string;
    createForum: boolean;
    isTask: boolean;
  }) {
    return discoverDiscordWork({
      ...input,
      http: this.http,
      authorization: this.authorization,
      guildId: this.config.guildId,
    });
  }
  async resumeStarter(input: {
    channelId: string;
    starterMessageId: string;
    title: string;
  }): Promise<CreatedConversation> {
    this.write();
    const parent = await this.channel(input.channelId);
    if (parent.type !== 0) throw new DiscordApiFailure('permission_denied');
    const existing = await this.http.request(`/channels/${input.starterMessageId}`, {
      authorization: this.authorization,
      unknownChannel: true,
    });
    if (existing) {
      const t = object(existing);
      if (
        t.id !== input.starterMessageId ||
        t.parent_id !== input.channelId ||
        t.guild_id !== this.config.guildId
      )
        throw new DiscordApiFailure('permission_denied');
      return { threadId: t.id, starterMessageId: t.id, cardChannelId: input.channelId };
    }
    const row = object(
      await this.http.request(
        `/channels/${input.channelId}/messages/${input.starterMessageId}/threads`,
        {
          method: 'POST',
          authorization: this.authorization,
          workCreation: true,
          jsonBody: { name: input.title.slice(0, 100), auto_archive_duration: 10080 },
        },
      ),
    );
    if (
      row.id !== input.starterMessageId ||
      row.parent_id !== input.channelId ||
      row.guild_id !== this.config.guildId
    )
      throw new DiscordApiFailure('invalid_response');
    return { threadId: row.id, starterMessageId: row.id, cardChannelId: input.channelId };
  }
  async sendCard(
    channelId: string,
    card: DiscordTaskMessage,
    operationId: string,
  ): Promise<string> {
    this.write();
    await this.channel(channelId);
    const nonce = (await digestToken(operationId)).slice(0, 24);
    const row = object(
      await this.http.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        authorization: this.authorization,
        jsonBody: { ...card, allowed_mentions: { parse: [] }, nonce, enforce_nonce: true },
      }),
    );
    if (!discordId(row.id) || row.channel_id !== channelId || row.nonce !== nonce)
      throw new DiscordApiFailure('invalid_response');
    return row.id;
  }
  async editCard(input: {
    channelId: string;
    messageId: string;
    card: DiscordTaskMessage;
  }): Promise<void> {
    this.write();
    await this.channel(input.channelId);
    const path = `/channels/${input.channelId}/messages/${input.messageId}`;
    const original = object(await this.http.request(path, { authorization: this.authorization }));
    const self = object(
      await this.http.request('/users/@me', { authorization: this.authorization }),
    );
    if (
      original.id !== input.messageId ||
      original.channel_id !== input.channelId ||
      object(original.author).id !== self.id
    )
      throw new DiscordApiFailure('permission_denied');
    const row = object(
      await this.http.request(path, {
        method: 'PATCH',
        authorization: this.authorization,
        jsonBody: { ...input.card, allowed_mentions: { parse: [] } },
      }),
    );
    if (row.id !== input.messageId || row.channel_id !== input.channelId)
      throw new DiscordApiFailure('invalid_response');
  }
}
