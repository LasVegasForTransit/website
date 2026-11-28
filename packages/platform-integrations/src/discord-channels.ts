// The Discord channels a member's LVBT roles open, read live from the server
// so the confirmation page can link to them by name. Read-only: nothing here
// writes to Discord or the database.
import { DiscordHttp } from './discord-http';
import { requestDiscordService } from './discord-service';
import {
  discordConfigured,
  discordId,
  DiscordApiFailure,
  object,
  type DiscordConfiguration,
  type DiscordOptions,
} from './discord-types';

export interface DiscordChannelLink {
  id: string;
  name: string;
  /** The channel's Discord topic, or its category name when it has no topic. */
  description: string | null;
}
export interface DiscordChannelsInput {
  member: boolean;
  roleIds: string[];
}
interface Role {
  id: string;
  name?: string | undefined;
  permissions: bigint;
}
interface Overwrite {
  id: string;
  type: number;
  allow: bigint;
  deny: bigint;
}
interface Channel {
  id: string;
  name: string;
  type: number;
  position: number;
  parentId: string | null;
  /** The raw Discord topic, turned into plain text once names are known. */
  topic: string | null;
  overwrites: Overwrite[];
}

const VIEW_CHANNEL = 1n << 10n;
const ADMINISTRATOR = 1n << 3n;
// Text, announcement, forum and media channels: the ones a link can open.
const LINKABLE = new Set([0, 5, 15, 16]);
const CATEGORY = 4;
const MAX_ROLES = 50;
const MAX_DESCRIPTION = 160;

/**
 * Plain text from a Discord topic: role and channel mentions become their names, other
 * mentions, emoji tags and markdown marks are removed, and the result is cut to one short line.
 */
export function plainTopic(value: unknown, names = new Map<string, string>()): string | null {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/<@&(\d+)>/g, (_, id: string) => (names.has(id) ? `@${names.get(id)}` : ''))
    .replace(/<#(\d+)>/g, (_, id: string) => (names.has(id) ? `#${names.get(id)}` : ''))
    .replace(/<@!?\d+>|<a?:\w+:\d+>/g, '')
    .replace(/\*+|~~|`+|\|\|/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…` : text;
}
function bits(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d{1,40}$/.test(value))
    throw new DiscordApiFailure('invalid_response');
  return BigInt(value);
}
function role(value: unknown): Role {
  const data = object(value);
  if (!discordId(data.id)) throw new DiscordApiFailure('invalid_response');
  return {
    id: data.id,
    name: typeof data.name === 'string' ? data.name : undefined,
    permissions: bits(data.permissions),
  };
}
function overwrite(value: unknown): Overwrite {
  const data = object(value);
  if (!discordId(data.id) || (data.type !== 0 && data.type !== 1))
    throw new DiscordApiFailure('invalid_response');
  return { id: data.id, type: data.type, allow: bits(data.allow), deny: bits(data.deny) };
}
function channel(value: unknown): Channel {
  const data = object(value);
  if (
    !discordId(data.id) ||
    typeof data.name !== 'string' ||
    !data.name.length ||
    data.name.length > 100 ||
    !Number.isSafeInteger(data.type) ||
    !Number.isSafeInteger(data.position) ||
    (data.parent_id !== null && data.parent_id !== undefined && !discordId(data.parent_id))
  )
    throw new DiscordApiFailure('invalid_response');
  const overwrites = data.permission_overwrites ?? [];
  if (!Array.isArray(overwrites)) throw new DiscordApiFailure('invalid_response');
  return {
    id: data.id,
    name: data.name,
    type: Number(data.type),
    position: Number(data.position),
    parentId: typeof data.parent_id === 'string' ? data.parent_id : null,
    topic: typeof data.topic === 'string' ? data.topic : null,
    overwrites: overwrites.map(overwrite),
  };
}

/** Discord's role-level permission check for one channel (member overwrites are ignored). */
function canView(guildId: string, roles: Role[], roleIds: Set<string>, item: Channel): boolean {
  let permissions = roles
    .filter((r) => r.id === guildId || roleIds.has(r.id))
    .reduce((value, r) => value | r.permissions, 0n);
  if (permissions & ADMINISTRATOR) return true;
  const everyone = item.overwrites.find((o) => o.type === 0 && o.id === guildId);
  if (everyone) permissions = (permissions & ~everyone.deny) | everyone.allow;
  let allow = 0n,
    deny = 0n;
  for (const o of item.overwrites)
    if (o.type === 0 && o.id !== guildId && roleIds.has(o.id)) {
      allow |= o.allow;
      deny |= o.deny;
    }
  permissions = (permissions & ~deny) | allow;
  return (permissions & VIEW_CHANNEL) !== 0n;
}

/** Channels these roles open that @everyone alone cannot see, in Discord's sidebar order. */
export function channelsOpenedBy(
  guildId: string,
  roles: Role[],
  channels: Channel[],
  roleIds: string[],
): DiscordChannelLink[] {
  const granted = new Set(roleIds);
  const nobody = new Set<string>();
  const categories = new Map(channels.filter((c) => c.type === CATEGORY).map((c) => [c.id, c]));
  const rank = (c: Channel) => (c.parentId ? (categories.get(c.parentId)?.position ?? -1) : -1);
  const names = new Map<string, string>([
    ...roles.flatMap((r): Array<[string, string]> => (r.name ? [[r.id, r.name]] : [])),
    ...channels.map((c): [string, string] => [c.id, c.name]),
  ]);
  const category = (c: Channel) => (c.parentId ? (categories.get(c.parentId)?.name ?? null) : null);
  return channels
    .filter(
      (c) =>
        LINKABLE.has(c.type) &&
        canView(guildId, roles, granted, c) &&
        !canView(guildId, roles, nobody, c),
    )
    .sort((a, b) => rank(a) - rank(b) || a.position - b.position || a.id.localeCompare(b.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      description: plainTopic(c.topic, names) ?? category(c),
    }));
}

export function parseDiscordChannelsInput(value: unknown): DiscordChannelsInput | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.member !== 'boolean' ||
    !Array.isArray(input.roleIds) ||
    input.roleIds.length > MAX_ROLES ||
    !input.roleIds.every((id) => discordId(id))
  )
    return null;
  return { member: input.member, roleIds: [...new Set(input.roleIds)] };
}

/** Runs in the jobs Worker, which holds the bot token. */
export async function readDiscordChannels(
  configuration: DiscordConfiguration,
  memberRoleId: string,
  input: DiscordChannelsInput,
  options: DiscordOptions = {},
): Promise<DiscordChannelLink[]> {
  if (!discordConfigured(configuration) || !discordId(memberRoleId))
    throw new DiscordApiFailure('not_configured');
  const http = new DiscordHttp(options),
    authorization = `Bot ${configuration.botToken}`;
  const roles = await http.request(`/guilds/${configuration.guildId}/roles`, {
    authorization,
    responseSize: 'guild-roles',
  });
  const channels = await http.request(`/guilds/${configuration.guildId}/channels`, {
    authorization,
    responseSize: 'work-history',
  });
  if (!Array.isArray(roles) || !Array.isArray(channels))
    throw new DiscordApiFailure('invalid_response');
  const roleIds = input.member ? [memberRoleId, ...input.roleIds] : input.roleIds;
  return channelsOpenedBy(configuration.guildId, roles.map(role), channels.map(channel), roleIds);
}

function parsedLink(item: unknown): DiscordChannelLink | null {
  if (typeof item !== 'object' || item === null) return null;
  const { id, name, description = null } = item as Record<string, unknown>;
  const validName = typeof name === 'string' && name.length > 0 && name.length <= 100;
  const validDescription =
    description === null ||
    (typeof description === 'string' &&
      description.length > 0 &&
      description.length <= MAX_DESCRIPTION);
  return discordId(id) && validName && validDescription
    ? { id, name, description: description }
    : null;
}
function parsedChannels(value: unknown): DiscordChannelLink[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const list = (value as Record<string, unknown>).channels;
  if (!Array.isArray(list) || list.length > 200) return null;
  const links = list.map(parsedLink);
  return links.every((link) => link !== null) ? links : null;
}

/** Runs in the site Worker. Returns null when the list is unavailable, so the page can fall back. */
export async function requestDiscordChannels(
  jobs: Pick<Fetcher, 'fetch'>,
  input: DiscordChannelsInput,
): Promise<DiscordChannelLink[] | null> {
  return parsedChannels(
    await requestDiscordService(jobs, '/discord/channels', input, {
      maxBytes: 65_536,
      timeoutMs: 3_000,
    }),
  );
}
