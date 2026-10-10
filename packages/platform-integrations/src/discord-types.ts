import type { AccessFailure } from '@lasvegasfortransit/platform-core/access';
import {
  isDiscordId as discordId,
  type DiscordIdentity,
} from '@lasvegasfortransit/platform-core/discord-identity';
export { discordId };
export type DiscordFailure =
  AccessFailure | 'not_configured' | 'invalid_response' | 'stale_operation' | 'screening_pending';
export class DiscordApiFailure extends Error {
  constructor(
    readonly kind: DiscordFailure,
    readonly retryAfterMs: number | null = null,
    readonly global = false,
  ) {
    super(`Discord request failed: ${kind}`);
    this.name = 'DiscordApiFailure';
  }
}
export interface DiscordConfiguration {
  environment: 'production' | 'preview';
  guildId: string;
  productionGuildId: string;
  botToken: string;
}
export interface DiscordRateLimit {
  current(): Promise<{ retryAfterMs: number; global: boolean } | null>;
  defer(pause: { retryAfterMs: number; global: boolean }): Promise<void>;
}
export interface DiscordOptions {
  rateLimit?: DiscordRateLimit;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}
export type DiscordUser = DiscordIdentity;
export interface DiscordMember {
  user: DiscordUser;
  roles: string[];
  pending: boolean;
  nickname: string | null;
}
export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DiscordApiFailure('invalid_response');
  return value as Record<string, unknown>;
}
function nullableText(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > maximum)
    throw new DiscordApiFailure('invalid_response');
  return value;
}
export function parseDiscordUser(value: unknown): DiscordUser {
  const data = object(value);
  if (
    !discordId(data.id) ||
    typeof data.username !== 'string' ||
    !data.username.length ||
    data.username.length > 32 ||
    data.bot === true
  )
    throw new DiscordApiFailure('invalid_response');
  const avatar = nullableText(data.avatar, 64);
  if (avatar !== null && !/^(a_)?[a-f0-9]{32}$/.test(avatar))
    throw new DiscordApiFailure('invalid_response');
  return {
    id: data.id,
    username: data.username,
    displayName: nullableText(data.global_name, 32),
    avatar,
  };
}
export function parseDiscordMember(value: unknown, expectedId: string): DiscordMember {
  const data = object(value);
  const user = parseDiscordUser(data.user);
  if (
    user.id !== expectedId ||
    !Array.isArray(data.roles) ||
    data.roles.length > 1000 ||
    !data.roles.every(discordId) ||
    (data.pending !== undefined && typeof data.pending !== 'boolean')
  )
    throw new DiscordApiFailure('invalid_response');
  return {
    user,
    roles: [...new Set(data.roles)].sort(),
    pending: data.pending === true,
    nickname: nullableText(data.nick, 32),
  };
}
export function discordConfigured(configuration: DiscordConfiguration): boolean {
  return (
    discordId(configuration.guildId) &&
    discordId(configuration.productionGuildId) &&
    /^[\x21-\x7e]{1,2048}$/.test(configuration.botToken) &&
    (configuration.environment === 'production'
      ? configuration.guildId === configuration.productionGuildId
      : configuration.guildId !== configuration.productionGuildId)
  );
}
