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
}
export interface DiscordChannelsInput {
  member: boolean;
  roleIds: string[];
}
interface Role {
  id: string;
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
  overwrites: Overwrite[];
}

const VIEW_CHANNEL = 1n << 10n;
const ADMINISTRATOR = 1n << 3n;
// Text, announcement, forum and media channels: the ones a link can open.
const LINKABLE = new Set([0, 5, 15, 16]);
const CATEGORY = 4;
const MAX_ROLES = 50;

function bits(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d{1,40}$/.test(value))
    throw new DiscordApiFailure('invalid_response');
  return BigInt(value);
}
function role(value: unknown): Role {
  const data = object(value);
  if (!discordId(data.id)) throw new DiscordApiFailure('invalid_response');
  return { id: data.id, permissions: bits(data.permissions) };
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
  const categories = new Map(
    channels.filter((c) => c.type === CATEGORY).map((c) => [c.id, c.position]),
  );
  const rank = (c: Channel) => (c.parentId ? (categories.get(c.parentId) ?? -1) : -1);
  return channels
    .filter(
      (c) =>
        LINKABLE.has(c.type) &&
        canView(guildId, roles, granted, c) &&
        !canView(guildId, roles, nobody, c),
    )
    .sort((a, b) => rank(a) - rank(b) || a.position - b.position || a.id.localeCompare(b.id))
    .map(({ id, name }) => ({ id, name }));
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

function parsedChannels(value: unknown): DiscordChannelLink[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const list = (value as Record<string, unknown>).channels;
  if (!Array.isArray(list) || list.length > 200) return null;
  const links: DiscordChannelLink[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) return null;
    const { id, name } = item as Record<string, unknown>;
    if (!discordId(id) || typeof name !== 'string' || !name.length || name.length > 100)
      return null;
    links.push({ id, name });
  }
  return links;
}

/** Runs in the site Worker. Returns null when the list is unavailable, so the page can fall back. */
export async function requestDiscordChannels(
  jobs: Pick<Fetcher, 'fetch'>,
  input: DiscordChannelsInput,
): Promise<DiscordChannelLink[] | null> {
  return parsedChannels(
    await requestDiscordService(jobs, '/discord/channels', input, {
      maxBytes: 32_768,
      timeoutMs: 3_000,
    }),
  );
}
