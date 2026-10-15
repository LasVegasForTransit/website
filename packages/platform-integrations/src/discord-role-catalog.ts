import { DiscordHttp } from './discord-http';
import {
  discordConfigured,
  discordId,
  DiscordApiFailure,
  object,
  parseDiscordGuildMember,
  type DiscordConfiguration,
  type DiscordOptions,
} from './discord-types';
export type { DiscordOptions } from './discord-types';
export interface DiscordCatalogRole {
  id: string;
  name: string;
  assignable: boolean;
}
interface Role {
  id: string;
  name: string;
  position: number;
  permissions: bigint;
  managed: boolean;
}
function role(value: unknown): Role {
  const data = object(value);
  if (
    !discordId(data.id) ||
    typeof data.name !== 'string' ||
    !data.name.trim() ||
    data.name.length > 100 ||
    !Number.isSafeInteger(data.position) ||
    Number(data.position) < 0 ||
    typeof data.permissions !== 'string' ||
    !/^\d{1,40}$/.test(data.permissions) ||
    typeof data.managed !== 'boolean'
  )
    throw new DiscordApiFailure('invalid_response');
  const tags = data.tags === undefined ? {} : object(data.tags);
  return {
    id: data.id,
    name: data.name,
    position: Number(data.position),
    permissions: BigInt(data.permissions),
    managed:
      data.managed ||
      [
        'bot_id',
        'integration_id',
        'premium_subscriber',
        'subscription_listing_id',
        'available_for_purchase',
        'guild_connections',
      ].some((key) => Object.hasOwn(tags, key)),
  };
}
function inventory(value: unknown): Role[] {
  if (!Array.isArray(value) || value.length > 1000) throw new DiscordApiFailure('invalid_response');
  const roles = value.map(role);
  if (new Set(roles.map((r) => r.id)).size !== roles.length)
    throw new DiscordApiFailure('invalid_response');
  return roles;
}
/** Read-only choices. The caller must refresh this inventory before saving a changed mapping. */
export async function readDiscordRoleCatalog(
  configuration: DiscordConfiguration,
  input: { applicationId: string; memberRoleId: string },
  options: DiscordOptions = {},
): Promise<DiscordCatalogRole[]> {
  if (
    !discordConfigured(configuration) ||
    !discordId(input.applicationId) ||
    !discordId(input.memberRoleId)
  )
    throw new DiscordApiFailure('not_configured');
  const http = new DiscordHttp(options),
    authorization = `Bot ${configuration.botToken}`;
  const application = object(await http.request('/applications/@me', { authorization }));
  if (application.id !== input.applicationId) throw new DiscordApiFailure('invalid_response');
  const user = object(await http.request('/users/@me', { authorization }));
  if (!discordId(user.id) || user.bot !== true) throw new DiscordApiFailure('invalid_response');
  const member = parseDiscordGuildMember(
    await http.request(`/guilds/${configuration.guildId}/members/${user.id}`, { authorization }),
  );
  if (member.id !== user.id || !member.bot || member.pending)
    throw new DiscordApiFailure('invalid_response');
  const roles = inventory(
    await http.request(`/guilds/${configuration.guildId}/roles`, {
      authorization,
      responseSize: 'guild-roles',
    }),
  );
  const everyone = roles.find((r) => r.id === configuration.guildId);
  const assigned = member.roleIds.map((id) => roles.find((r) => r.id === id));
  if (!everyone || assigned.some((r) => !r) || !assigned.length)
    throw new DiscordApiFailure('invalid_response');
  const botRoles = assigned.filter((r): r is Role => Boolean(r));
  const permissions = botRoles.reduce((value, r) => value | r.permissions, everyone.permissions);
  if ((permissions & ((1n << 28n) | 8n)) === 0n) throw new DiscordApiFailure('permission_denied');
  const highest = Math.max(...botRoles.map((r) => r.position));
  return roles
    .map((r) => ({
      id: r.id,
      name: r.name,
      assignable:
        !r.managed &&
        r.id !== configuration.guildId &&
        r.id !== input.memberRoleId &&
        r.position < highest &&
        !member.roleIds.includes(r.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
