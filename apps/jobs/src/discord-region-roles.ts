import type { DiscordRegionRoleChoices } from '@lasvegasfortransit/platform-core/discord-role-settings';
import {
  listDiscordRegionSettings,
  saveDiscordRegionSettings,
  normalizeDiscordRegionSettings,
  DISCORD_ROLE_REGISTRY,
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
function response(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
export async function handleDiscordRegionRolesRequest(
  request: Request,
  env: DiscordRuntimeEnv & { PLATFORM_DB: Db },
  options: DiscordOptions = {},
): Promise<Response> {
  if (request.method !== 'POST' || request.url !== 'https://jobs.internal/discord/region-roles')
    return response({ kind: 'not_found' }, 404);
  if (request.headers.get('Content-Type') !== 'application/json')
    return response({ kind: 'invalid' }, 400);
  const input = await readDiscordInput(request);
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return response({ kind: 'invalid' }, 400);
  const v = input as Record<string, unknown>;
  if (
    typeof v.actorId !== 'string' ||
    v.actorId.length > 100 ||
    typeof v.guildId !== 'string' ||
    !['list', 'save'].includes(String(v.action))
  )
    return response({ kind: 'invalid' }, 400);
  const db = env.PLATFORM_DB,
    actor = await loadActor(db, v.actorId);
  if (!actor?.staffAdmin || actor.membershipStatus !== 'member')
    return response({ kind: 'forbidden' }, 403);
  const settings =
    v.settings && typeof v.settings === 'object' && !Array.isArray(v.settings)
      ? normalizeDiscordRegionSettings(v.settings as DiscordRegionSettingsInput)
      : null;
  if (v.action === 'save' && !settings) return response({ kind: 'invalid' }, 400);
  try {
    const regions = await listDiscordRegionSettings(db, actor.personId),
      current = regions.find((r) => r.id === settings?.regionId);
    if (v.action === 'save' && settings && current?.roleId === settings.roleId) {
      const result = await saveDiscordRegionSettings(db, actor, settings);
      return response(result, result.kind === 'ok' ? 200 : 409);
    }
    const runtime = discordRuntime(env);
    if (!runtime || runtime.configuration.guildId !== v.guildId)
      return response({ kind: 'unavailable' }, 503);
    const roles = await readDiscordRoleCatalog(runtime.configuration, runtime, {
      ...options,
      rateLimit: discordRateLimit(db, runtime.applicationId),
    });
    const fresh = await loadActor(db, actor.personId);
    if (!fresh?.staffAdmin || fresh.membershipStatus !== 'member')
      return response({ kind: 'forbidden' }, 403);
    const { results: registered } = await db
      .prepare(DISCORD_ROLE_REGISTRY)
      .all<{ owner: string; role_id: string }>();
    const choices: DiscordRegionRoleChoices = {
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
    if (v.action === 'list') return response(choices);
    if (!settings || !current) return response({ kind: 'invalid' }, 400);
    if (
      settings.roleId &&
      !choices.regions
        .find((r) => r.id === settings.regionId)
        ?.roles.some((role) => role.id === settings.roleId)
    )
      return response({ kind: 'invalid_role' }, 400);
    const result = await saveDiscordRegionSettings(db, actor, settings);
    return response(result, result.kind === 'ok' ? 200 : result.kind === 'forbidden' ? 403 : 409);
  } catch {
    return response({ kind: 'unavailable' }, 503);
  }
}
