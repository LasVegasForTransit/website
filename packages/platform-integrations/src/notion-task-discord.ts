import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { DiscordHttp } from './discord-http';
import {
  discordId,
  DiscordApiFailure,
  object,
  parseDiscordMember,
  type DiscordOptions,
} from './discord-types';
import type { DiscordTaskMessage } from './notion-task-cards';

/** Channels are accepted only after this instance verifies a one-to-one DM recipient. */
export class DiscordTaskClient {
  private readonly http: DiscordHttp;
  private readonly authorization: string;
  private readonly channels = new Map<string, string>();
  constructor(private readonly options: DiscordOptions & { guildId: string; botToken: string }) {
    if (!discordId(options.guildId) || !options.botToken.trim())
      throw new DiscordApiFailure('not_configured');
    this.authorization = `Bot ${options.botToken}`;
    this.http = new DiscordHttp(options);
  }
  async membership(userId: string, guildId: string): Promise<boolean> {
    if (!discordId(userId) || guildId !== this.options.guildId) return false;
    const value = await this.http.request(`/guilds/${guildId}/members/${userId}`, {
      authorization: this.authorization,
      unknownMember: true,
    });
    return value !== null && !parseDiscordMember(value, userId).pending;
  }
  async openDM(userId: string): Promise<string> {
    if (!discordId(userId)) throw new DiscordApiFailure('invalid_response');
    const channel = object(
      await this.http.request('/users/@me/channels', {
        method: 'POST',
        authorization: this.authorization,
        jsonBody: { recipient_id: userId },
      }),
    );
    if (
      !discordId(channel.id) ||
      channel.type !== 1 ||
      !Array.isArray(channel.recipients) ||
      channel.recipients.length !== 1 ||
      object(channel.recipients[0]).id !== userId
    )
      throw new DiscordApiFailure('invalid_response');
    this.channels.set(channel.id, userId);
    return channel.id;
  }
  private requireDM(channelId: string, userId: string): void {
    if (this.channels.get(channelId) !== userId || !discordId(channelId))
      throw new DiscordApiFailure('stale_operation');
  }
  async sendCard(
    channelId: string,
    userId: string,
    card: DiscordTaskMessage,
    operationId: string,
  ): Promise<{ messageId: string; nonce: string }> {
    this.requireDM(channelId, userId);
    const nonce = (await digestToken(operationId)).slice(0, 24);
    const response = object(
      await this.http.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        authorization: this.authorization,
        jsonBody: { ...card, allowed_mentions: { parse: [] }, nonce, enforce_nonce: true },
      }),
    );
    if (!discordId(response.id) || response.channel_id !== channelId || response.nonce !== nonce)
      throw new DiscordApiFailure('invalid_response');
    return { messageId: response.id, nonce };
  }
  async updateCard(
    channelId: string,
    userId: string,
    messageId: string,
    card: DiscordTaskMessage,
  ): Promise<void> {
    this.requireDM(channelId, userId);
    if (!discordId(messageId)) throw new DiscordApiFailure('invalid_response');
    const response = object(
      await this.http.request(`/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH',
        authorization: this.authorization,
        jsonBody: { ...card, allowed_mentions: { parse: [] } },
      }),
    );
    if (response.id !== messageId || response.channel_id !== channelId)
      throw new DiscordApiFailure('invalid_response');
  }
}
