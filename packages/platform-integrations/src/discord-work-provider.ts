import { discoverDiscordWork, discoverLinkedEvent } from './discord-work-discovery';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { object, discordId, DiscordApiFailure } from './discord-types';
import { DiscordWorkProviderBase } from './discord-work-provider-base';
import {
  validTagSet,
  validPinnedThread,
  validPinnedResponse,
  sameTags,
  updatedTagsMatch,
} from './discord-work-provider-validation';
import type { ConversationCreateInput, CreatedConversation } from './discord-work-provider-base';
import type { DiscordTaskMessage } from './notion-task-cards';
export type {
  DestinationInspection,
  CreatedConversation,
  ConversationCreateInput,
} from './discord-work-provider-base';

function requireCreation(input: ConversationCreateInput): void {
  const d = input.destination;
  if (d.isCategory) throw new Error('category_is_not_a_conversation');
  if (d.destination.kind === 'thread') throw new Error('nested_threads_unavailable');
  if (!d.canSend || d.locked || d.archived) throw new DiscordApiFailure('permission_denied');
  if (d.requiredTag && !input.tagIds.length) throw new Error('forum_tag_required');
  if (input.tagIds.some((id) => !d.tags.some((t) => t.id === id)))
    throw new Error('invalid_forum_tag');
}
export class DiscordWorkClient extends DiscordWorkProviderBase {
  /** Discord does not provide an atomic compare-and-set for channel topics. */
  async readForumTopic(forumId: string): Promise<string | null> {
    const forum = await this.channel(forumId);
    if (forum.type !== 15 || (forum.topic !== null && typeof forum.topic !== 'string'))
      throw new DiscordApiFailure('invalid_response');
    return forum.topic;
  }
  async updateForumTopic(input: {
    forumId: string;
    expectedTopic: string | null;
    topic: string;
  }): Promise<void> {
    this.write();
    if (input.topic.length > 4096) throw new DiscordApiFailure('invalid_response');
    const forum = await this.channel(input.forumId);
    if (forum.type !== 15 || (forum.topic !== null && typeof forum.topic !== 'string'))
      throw new DiscordApiFailure('invalid_response');
    if (forum.topic !== input.expectedTopic) throw new Error('forum_topic_changed');
    if (forum.topic === input.topic) return;
    const updated = object(
      await this.http.request(`/channels/${input.forumId}`, {
        method: 'PATCH',
        authorization: this.authorization,
        reason: 'Update the project forum topic',
        jsonBody: { topic: input.topic },
      }),
    );
    if (
      updated.id !== input.forumId ||
      updated.guild_id !== this.config.guildId ||
      updated.type !== 15 ||
      updated.topic !== input.topic
    )
      throw new DiscordApiFailure('invalid_response');
  }
  async readForumTags(forumId: string, threadId: string): Promise<string[]> {
    const thread = await this.channel(threadId);
    const metadata = object(thread.thread_metadata);
    if (
      !discordId(forumId) ||
      thread.type !== 11 ||
      thread.parent_id !== forumId ||
      metadata.archived !== false ||
      metadata.locked !== false ||
      !Array.isArray(thread.applied_tags) ||
      thread.applied_tags.length > 5 ||
      !thread.applied_tags.every(discordId) ||
      new Set(thread.applied_tags).size !== thread.applied_tags.length
    )
      throw new DiscordApiFailure('invalid_response');
    return thread.applied_tags;
  }
  /** Rechecks the observed set; Discord does not support atomic conditional thread updates. */
  async updateForumTags(input: {
    forumId: string;
    threadId: string;
    expectedTags: string[];
    tags: string[];
  }): Promise<void> {
    this.write();
    if (!discordId(input.forumId) || !validTagSet(input.expectedTags) || !validTagSet(input.tags))
      throw new DiscordApiFailure('invalid_response');
    const thread = await this.channel(input.threadId);
    const metadata = object(thread.thread_metadata);
    if (
      thread.type !== 11 ||
      thread.parent_id !== input.forumId ||
      metadata.archived !== false ||
      metadata.locked !== false ||
      !validTagSet(thread.applied_tags)
    )
      throw new DiscordApiFailure('invalid_response');
    if (!sameTags(thread.applied_tags, input.expectedTags)) throw new Error('forum_tags_changed');
    if (sameTags(thread.applied_tags, input.tags)) return;
    const updated = object(
      await this.http.request(`/channels/${input.threadId}`, {
        method: 'PATCH',
        authorization: this.authorization,
        reason: 'Update project forum tags',
        jsonBody: { applied_tags: input.tags },
      }),
    );
    if (!updatedTagsMatch(updated, input, this.config.guildId))
      throw new DiscordApiFailure('invalid_response');
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
  async pinForumPost(forumId: string, threadId: string): Promise<void> {
    this.write();
    const parent = await this.channel(forumId);
    const thread = await this.channel(threadId);
    if (!validPinnedThread(parent, thread, forumId))
      throw new DiscordApiFailure('invalid_response');
    const flags = BigInt(Number(thread.flags));
    if ((flags & 2n) !== 0n) return;
    const active = object(
      await this.http.request(`/guilds/${this.config.guildId}/threads/active`, {
        authorization: this.authorization,
        responseSize: 'work-history',
      }),
    );
    if (!Array.isArray(active.threads)) throw new DiscordApiFailure('invalid_response');
    for (const value of active.threads) {
      const other = object(value);
      if (other.parent_id !== forumId || other.id === threadId) continue;
      if (!Number.isSafeInteger(other.flags) || Number(other.flags) < 0)
        throw new DiscordApiFailure('invalid_response');
      if ((BigInt(Number(other.flags)) & 2n) !== 0n)
        throw new Error('forum_already_has_pinned_post');
    }
    const next = Number(flags | 2n);
    if (!Number.isSafeInteger(next)) throw new DiscordApiFailure('invalid_response');
    const updated = object(
      await this.http.request(`/channels/${threadId}`, {
        method: 'PATCH',
        authorization: this.authorization,
        jsonBody: { flags: next },
        reason: 'Pin the project overview post',
      }),
    );
    if (!validPinnedResponse(updated, { threadId, guildId: this.config.guildId, forumId }))
      throw new DiscordApiFailure('invalid_response');
  }
  /** A missing or ambiguous marker never authorizes another creation. */
  async findCreatedCategory(operationId: string): Promise<string | null> {
    if (!/^[\w-]{1,64}$/.test(operationId)) throw new DiscordApiFailure('invalid_response');
    const self = object(
      await this.http.request('/users/@me', { authorization: this.authorization }),
    );
    if (!discordId(self.id)) throw new DiscordApiFailure('invalid_response');
    const logs = object(
      await this.http.request(
        `/guilds/${this.config.guildId}/audit-logs?user_id=${self.id}&action_type=10&limit=100`,
        { authorization: this.authorization, responseSize: 'work-history' },
      ),
    );
    if (!Array.isArray(logs.audit_log_entries)) throw new DiscordApiFailure('invalid_response');
    const matches = logs.audit_log_entries
      .map(object)
      .filter(
        (entry) =>
          entry.action_type === 10 &&
          entry.user_id === self.id &&
          entry.reason === `LVBT route setup ${operationId}` &&
          discordId(entry.target_id),
      );
    if (matches.length !== 1) return null;
    const id = String(matches[0]?.target_id);
    const channel = await this.channel(id);
    return channel.type === 4 && (channel.parent_id ?? null) === null ? id : null;
  }
  async findRouteDestination(input: {
    kind: 'text' | 'forum';
    parentId: string;
    operationId: string;
  }): Promise<string | null> {
    if (!discordId(input.parentId) || !/^[\w-]{1,64}$/.test(input.operationId))
      throw new DiscordApiFailure('invalid_response');
    const channels = await this.http.request(`/guilds/${this.config.guildId}/channels`, {
      authorization: this.authorization,
      responseSize: 'work-history',
    });
    if (!Array.isArray(channels)) throw new DiscordApiFailure('invalid_response');
    const matches = channels
      .map(object)
      .filter(
        (channel) =>
          channel.guild_id === this.config.guildId &&
          channel.parent_id === input.parentId &&
          channel.type === (input.kind === 'forum' ? 15 : 0) &&
          channel.topic === `LVBT route setup: ${input.operationId}` &&
          discordId(channel.id),
      );
    return matches.length === 1 ? String(matches[0]?.id) : null;
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
  findLinkedEvent(forumId: string, pageId: string) {
    return discoverLinkedEvent({
      http: this.http,
      authorization: this.authorization,
      guildId: this.config.guildId,
      forumId,
      pageId,
    });
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
