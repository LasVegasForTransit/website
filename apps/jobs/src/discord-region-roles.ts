import type { DiscordRegionRoleChoices } from '@lasvegasfortransit/platform-core/discord-role-settings';
import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import {
  listDiscordRegionSettings,
  saveDiscordRegionSettings,
  normalizeDiscordRegionSettings,
  DISCORD_ROLE_REGISTRY,
  type DiscordRegionSetting,
  type DiscordRegionSettingsInput,
} from '@lasvegasfortransit/platform-storage/discord-region-settings';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  discordRuntime,
  type DiscordRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/discord-runtime';
import {
  readDiscordRoleCatalog,
  type DiscordOptions,
} from '@lasvegasfortransit/platform-integrations/discord-role-catalog';
import { discordRateLimit } from '@lasvegasfortransit/platform-integrations/discord-rate-limit';
import { readDiscordInput } from './discord-request';

type Env = DiscordRuntimeEnv & { PLATFORM_DB: Db };
interface RegionRequest {
  actorId: string;
  guildId: string;
  action: 'list' | 'save';
  settings: DiscordRegionSettingsInput | null;
}

function response(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseRegionRequest(v: Record<string, unknown>): RegionRequest | null {
  if (
    typeof v.actorId !== 'string' ||
    v.actorId.length > 100 ||
    typeof v.guildId !== 'string' ||
    (v.action !== 'list' && v.action !== 'save')
  )
    return null;
  const settings = isRecord(v.settings)
    ? normalizeDiscordRegionSettings(v.settings as unknown as DiscordRegionSettingsInput)
    : null;
  if (v.action === 'save' && !settings) return null;
  return { actorId: v.actorId, guildId: v.guildId, action: v.action, settings };
}

async function readRegionRequest(request: Request): Promise<RegionRequest | Response> {
  if (request.method !== 'POST' || request.url !== 'https://jobs.internal/discord/region-roles')
    return response({ kind: 'not_found' }, 404);
  if (request.headers.get('Content-Type') !== 'application/json')
    return response({ kind: 'invalid' }, 400);
  const input = await readDiscordInput(request);
  const parsed = isRecord(input) ? parseRegionRequest(input) : null;
  return parsed ?? response({ kind: 'invalid' }, 400);
}

async function currentAdministrator(db: Db, personId: string): Promise<Actor | null> {
  const actor = await loadActor(db, personId);
  return actor?.staffAdmin && actor.membershipStatus === 'member' ? actor : null;
}

/** Offer only assignable roles named like the region that no committee or other region owns. */
async function regionChoices(
  env: Env,
  guildId: string,
  regions: DiscordRegionSetting[],
  options: DiscordOptions,
): Promise<DiscordRegionRoleChoices | null> {
  const runtime = discordRuntime(env);
  if (runtime?.configuration.guildId !== guildId) return null;
  const roles = await readDiscordRoleCatalog(runtime.configuration, runtime, {
    ...options,
    rateLimit: discordRateLimit(env.PLATFORM_DB, runtime.applicationId),
  });
  const { results: registered } = await env.PLATFORM_DB.prepare(DISCORD_ROLE_REGISTRY).all<{
    owner: string;
    role_id: string;
  }>();
  return {
    regions: regions.map((region) => {
      const available = roles
        .filter(
          (role) =>
            role.assignable &&
            role.name === region.name &&
            !registered.some((r) => r.role_id === role.id && r.owner !== `region:${region.id}`),
        )
        .map(({ id, name }) => ({ id, name }));
      return {
        ...region,
        roles: available,
        currentRole: region.roleId
          ? {
              id: region.roleId,
              name:
                roles.find((r) => r.id === region.roleId)?.name ?? 'Previous role is unavailable',
              available: available.some((r) => r.id === region.roleId),
            }
          : null,
      };
    }),
  };
}

async function save(db: Db, actor: Actor, settings: DiscordRegionSettingsInput) {
  const result = await saveDiscordRegionSettings(db, actor, settings);
  return response(result, result.kind === 'ok' ? 200 : result.kind === 'forbidden' ? 403 : 409);
}

/** A save may only pick a role that the fresh Discord read just offered for that region. */
async function saveOffered(
  db: Db,
  actor: Actor,
  settings: DiscordRegionSettingsInput | null,
  choices: DiscordRegionRoleChoices,
) {
  const region = settings && choices.regions.find((r) => r.id === settings.regionId);
  if (!settings || !region) return response({ kind: 'invalid' }, 400);
  if (settings.roleId && !region.roles.some((role) => role.id === settings.roleId))
    return response({ kind: 'invalid_role' }, 400);
  return await save(db, actor, settings);
}

export async function handleDiscordRegionRolesRequest(
  request: Request,
  env: Env,
  options: DiscordOptions = {},
): Promise<Response> {
  const input = await readRegionRequest(request);
  if (input instanceof Response) return input;
  const db = env.PLATFORM_DB;
  const actor = await currentAdministrator(db, input.actorId);
  if (!actor) return response({ kind: 'forbidden' }, 403);
  const { settings } = input;
  try {
    const regions = await listDiscordRegionSettings(db, actor.personId);
    const current = regions.find((r) => r.id === settings?.regionId);
    // Saving the role a region already has needs no fresh Discord read; it only bumps the version.
    if (input.action === 'save' && settings && current?.roleId === settings.roleId)
      return await save(db, actor, settings);
    const choices = await regionChoices(env, input.guildId, regions, options);
    if (!choices) return response({ kind: 'unavailable' }, 503);
    // The Discord read can take a while, so authority is checked again before using it.
    if (!(await currentAdministrator(db, actor.personId)))
      return response({ kind: 'forbidden' }, 403);
    if (input.action === 'list') return response(choices);
    return await saveOffered(db, actor, settings, choices);
  } catch {
    return response({ kind: 'unavailable' }, 503);
  }
}
