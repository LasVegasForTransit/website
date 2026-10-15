import type {
  DiscordCommitteeRoleChoices,
  DiscordRoleChoice,
} from '@lasvegasfortransit/platform-core/discord-role-settings';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import {
  normalizeSettings,
  updateCommitteeSettings,
  type CommitteeSettingsInput,
} from '@lasvegasfortransit/platform-storage/committee-settings';
import {
  discordRuntime,
  type DiscordRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/discord-runtime';
import {
  readDiscordRoleCatalog,
  type DiscordCatalogRole,
} from '@lasvegasfortransit/platform-integrations/discord-role-catalog';
import { discordRateLimit } from '@lasvegasfortransit/platform-integrations/discord-rate-limit';
import type { DiscordOptions } from '@lasvegasfortransit/platform-integrations/discord-role-catalog';
import { readDiscordInput } from './discord-request';
interface Input {
  actorId: string;
  committeeId: string;
  guildId: string;
  action: 'list' | 'save';
  settings?: CommitteeSettingsInput;
}
interface Current {
  discordRoleId: string | null;
  discordLeadRoleId: string | null;
}
function response(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
function parse(value: unknown): Input | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    ![v.actorId, v.committeeId, v.guildId].every(
      (x) => typeof x === 'string' && x.length > 0 && x.length <= 100,
    ) ||
    !['list', 'save'].includes(String(v.action))
  )
    return null;
  const base = {
    actorId: String(v.actorId),
    committeeId: String(v.committeeId),
    guildId: String(v.guildId),
    action: v.action as Input['action'],
  };
  if (v.action === 'list') return base;
  if (!v.settings || typeof v.settings !== 'object' || Array.isArray(v.settings)) return null;
  const settings = normalizeSettings(v.settings as CommitteeSettingsInput);
  return settings ? { ...base, settings } : null;
}
async function administrator(db: Db, id: string) {
  const actor = await loadActor(db, id);
  return actor?.staffAdmin && actor.membershipStatus === 'member' ? actor : null;
}
async function choices(
  db: Db,
  committeeId: string,
  roles: DiscordCatalogRole[],
  current: Current,
): Promise<DiscordCommitteeRoleChoices> {
  const { results } = await db
    .prepare(
      `SELECT committee_id,external_id,role_kind FROM committee_account_mappings WHERE provider='discord'
        UNION SELECT id,discord_role_id,'member' FROM committees WHERE discord_role_id IS NOT NULL
        UNION SELECT id,discord_lead_role_id,'lead' FROM committees WHERE discord_lead_role_id IS NOT NULL`,
    )
    .all<{ committee_id: string; external_id: string; role_kind: string }>();
  const available = (kind: string): DiscordRoleChoice[] =>
    roles
      .filter(
        (role) =>
          role.assignable &&
          !results.some(
            (m) =>
              m.external_id === role.id && (m.committee_id !== committeeId || m.role_kind !== kind),
          ),
      )
      .map(({ id, name }) => ({ id, name }));
  const memberRoles = available('member'),
    leadRoles = available('lead');
  const selected = (id: string | null, list: DiscordRoleChoice[]) =>
    id
      ? {
          id,
          name: roles.find((r) => r.id === id)?.name ?? 'Previous role is unavailable',
          available: list.some((r) => r.id === id),
        }
      : null;
  return {
    memberRoles,
    leadRoles,
    currentMemberRole: selected(current.discordRoleId, memberRoles),
    currentLeadRole: selected(current.discordLeadRoleId, leadRoles),
  };
}
function validSelection(input: CommitteeSettingsInput, list: DiscordCommitteeRoleChoices) {
  return (
    (!input.discordRoleId || list.memberRoles.some((r) => r.id === input.discordRoleId)) &&
    (!input.discordLeadRoleId || list.leadRoles.some((r) => r.id === input.discordLeadRoleId))
  );
}
function saveStatus(kind: string): number {
  const statuses: Record<string, number> = { ok: 200, invalid: 400, forbidden: 403 };
  return statuses[kind] ?? 409;
}
function rolesUnchanged(settings: CommitteeSettingsInput | undefined, current: Current): boolean {
  return (
    settings?.discordRoleId === current.discordRoleId &&
    (settings.discordLeadRoleId ?? null) === current.discordLeadRoleId
  );
}
async function dispatch(
  input: Input,
  env: DiscordRuntimeEnv & { PLATFORM_DB: Db },
  options: DiscordOptions,
): Promise<Response> {
  const db = env.PLATFORM_DB,
    actor = await administrator(db, input.actorId);
  if (!actor) return response({ kind: 'forbidden' }, 403);
  const current = await db
    .prepare(
      'SELECT discord_role_id AS discordRoleId,discord_lead_role_id AS discordLeadRoleId FROM committees WHERE id=?',
    )
    .bind(input.committeeId)
    .first<Current>();
  if (!current) return response({ kind: 'not_found' }, 404);
  const unchanged = input.action === 'save' && rolesUnchanged(input.settings, current);
  if (!unchanged) {
    const runtime = discordRuntime(env);
    if (runtime?.configuration.guildId !== input.guildId)
      return response({ kind: 'unavailable' }, 503);
    const roles = await readDiscordRoleCatalog(runtime.configuration, runtime, {
      ...options,
      rateLimit: discordRateLimit(db, runtime.applicationId),
    });
    if (!(await administrator(db, input.actorId))) return response({ kind: 'forbidden' }, 403);
    const list = await choices(db, input.committeeId, roles, current);
    if (input.action === 'list') return response(list);
    if (!input.settings || !validSelection(input.settings, list))
      return response({ kind: 'invalid_role' }, 400);
  }
  if (!input.settings) return response({ kind: 'invalid' }, 400);
  const result = await updateCommitteeSettings(db, actor, input.committeeId, input.settings);
  return response(result, saveStatus(result.kind));
}
export async function handleDiscordCommitteeRolesRequest(
  request: Request,
  env: DiscordRuntimeEnv & { PLATFORM_DB: Db },
  options: DiscordOptions = {},
): Promise<Response> {
  if (request.method !== 'POST' || request.url !== 'https://jobs.internal/discord/committee-roles')
    return response({ kind: 'not_found' }, 404);
  if (request.headers.get('Content-Type') !== 'application/json')
    return response({ kind: 'invalid' }, 400);
  const input = parse(await readDiscordInput(request));
  if (!input) return response({ kind: 'invalid' }, 400);
  try {
    return await dispatch(input, env, options);
  } catch {
    return response({ kind: 'unavailable' }, 503);
  }
}
