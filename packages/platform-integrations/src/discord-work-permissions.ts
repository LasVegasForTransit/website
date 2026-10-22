import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { object, discordId, DiscordApiFailure } from './discord-types';
export interface WorkRole {
  id: string;
  permissions: string;
}
export interface WorkOverwrite {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
}
function bits(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,24}$/.test(value))
    throw new DiscordApiFailure('invalid_response');
  return value;
}
export function workRoles(value: unknown): WorkRole[] {
  if (!Array.isArray(value)) throw new DiscordApiFailure('invalid_response');
  return value.map((v) => {
    const r = object(v);
    if (!discordId(r.id)) throw new DiscordApiFailure('invalid_response');
    return { id: r.id, permissions: bits(r.permissions) };
  });
}
export function workOverwrites(value: unknown): WorkOverwrite[] {
  if (!Array.isArray(value)) throw new DiscordApiFailure('invalid_response');
  return value.map((v) => {
    const r = object(v);
    if (!discordId(r.id) || (r.type !== 0 && r.type !== 1))
      throw new DiscordApiFailure('invalid_response');
    return { id: r.id, type: r.type, allow: bits(r.allow), deny: bits(r.deny) };
  });
}
export function workPermissions(input: {
  guildId: string;
  userId: string;
  memberRoles: string[];
  roles: WorkRole[];
  overwrites: WorkOverwrite[];
}): bigint {
  const ids = new Set([input.guildId, ...input.memberRoles]);
  let base = input.roles
    .filter((r) => ids.has(r.id))
    .reduce((b, r) => b | BigInt(r.permissions), 0n);
  if (base & 8n) return (1n << 60n) - 1n;
  const everyone = input.overwrites.find((o) => o.type === 0 && o.id === input.guildId);
  if (everyone) base = (base & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  const assigned = input.overwrites.filter(
    (o) => o.type === 0 && o.id !== input.guildId && ids.has(o.id),
  );
  base =
    (base & ~assigned.reduce((b, r) => b | BigInt(r.deny), 0n)) |
    assigned.reduce((b, r) => b | BigInt(r.allow), 0n);
  const personal = input.overwrites.find((o) => o.type === 1 && o.id === input.userId);
  return personal ? (base & ~BigInt(personal.deny)) | BigInt(personal.allow) : base;
}
export function workAudience(
  roles: WorkRole[],
  overwrites: WorkOverwrite[],
  _parentId: string | null,
): Promise<string> {
  return digestToken(
    JSON.stringify([
      [...roles].sort((a, b) => a.id.localeCompare(b.id)),
      [...overwrites].sort((a, b) => a.id.localeCompare(b.id)),
    ]),
  );
}
