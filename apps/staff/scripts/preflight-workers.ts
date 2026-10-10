import { type MetadataClient, array, object } from './preflight-api';
import { check, type Check, type Environment } from './preflight-config';
import {
  discordProviderConfiguration,
  type DiscordRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/discord-runtime';
import { STAFF_WORKER_BINDINGS } from '@lasvegasfortransit/platform-integrations/worker-runtime-config';
export type Bindings = Record<string, unknown>[];
export function value(bindings: Bindings, name: string): unknown {
  return bindings.find((binding) => binding.name === name && binding.type === 'plain_text')?.text;
}
async function activeBindings(client: MetadataClient, path: string): Promise<Bindings[]> {
  const active = array(object(await client.get(`${path}/deployments`)).deployments).at(0);
  const versions = array(active?.versions ?? []).filter(
    (version) => Number(version.percentage) > 0,
  );
  if (
    !versions.length ||
    versions.reduce((sum, version) => sum + Number(version.percentage), 0) !== 100
  )
    throw new Error('Active deployment unavailable');
  return await Promise.all(
    versions.map(async (version) => {
      if (typeof version.version_id !== 'string') throw new Error('Invalid version');
      const data = object(
        await client.get(`${path}/versions/${encodeURIComponent(version.version_id)}`),
      );
      return array(object(data.resources).bindings);
    }),
  );
}
export async function inspectWorker(
  client: MetadataClient,
  name: string,
  kind: 'staff' | 'jobs',
  databaseId: string,
) {
  const path = `/workers/scripts/${encodeURIComponent(name)}`;
  const versions = await activeBindings(client, path);
  const bindings = versions.at(0) ?? [];
  const required = STAFF_WORKER_BINDINGS[kind];
  return {
    bindings,
    checks: [
      check(
        `${kind}.deployment`,
        versions.length > 0,
        'Worker must have an active deployed version.',
      ),
      check(
        `${kind}.database`,
        versions.every((bindings) =>
          bindings.some(
            (binding) =>
              binding.type === 'd1' && binding.name === 'PLATFORM_DB' && binding.id === databaseId,
          ),
        ),
        'Deployed PLATFORM_DB must match the selected environment.',
      ),
      check(
        `${kind}.version_configuration`,
        versions.every((candidate) =>
          [
            'LVBT_ACCESS_AUD',
            'LVBT_ACCESS_TEAM_DOMAIN',
            'LVBT_GOOGLE_OAUTH_CLIENT_ID',
            'LVBT_DEPLOYMENT_ENV',
            'LVBT_DISCORD_SYNC_ENABLED',
            'LVBT_DISCORD_APPLICATION_ID',
            'LVBT_DISCORD_GUILD_ID',
            'LVBT_DISCORD_PRODUCTION_GUILD_ID',
            'LVBT_DISCORD_MEMBER_ROLE_ID',
          ].every((name) => value(candidate, name) === value(bindings, name)),
        ),
        'Every active version must use matching authentication and Discord configuration.',
      ),
      ...required.map((name) =>
        check(
          `${kind}.binding.${name}`,
          versions.every((bindings) =>
            bindings.some(
              (binding) =>
                binding.name === name &&
                (binding.type === 'secret_text' ||
                  ([
                    'LVBT_ACCESS_TEAM_DOMAIN',
                    'LVBT_ACCESS_AUD',
                    'LVBT_GOOGLE_OAUTH_CLIENT_ID',
                  ].includes(name) &&
                    binding.type === 'plain_text' &&
                    Boolean(binding.text))),
            ),
          ),
          `Configure ${name}; presence does not prove provider validity.`,
        ),
      ),
      ...(kind === 'staff'
        ? [
            check(
              'staff.no_bot_token',
              versions.every(
                (bindings) =>
                  !bindings.some((binding) => binding.name === 'LVBT_DISCORD_BOT_TOKEN'),
              ),
              'Bot credentials belong only on jobs.',
            ),
          ]
        : []),
    ],
  };
}
export function inspectDiscord(staff: Bindings, jobs: Bindings, environment: Environment): Check {
  const publicValues = (bindings: Bindings) =>
    Object.fromEntries(
      bindings
        .filter((binding) => binding.type === 'plain_text' && typeof binding.text === 'string')
        .map((binding) => [String(binding.name), binding.text]),
    ) as DiscordRuntimeEnv;
  const staffEnv = publicValues(staff);
  const jobsEnv = publicValues(jobs);
  return check(
    'discord.configuration',

    staffEnv.LVBT_DEPLOYMENT_ENV === environment &&
      discordProviderConfiguration(staffEnv).configured &&
      discordProviderConfiguration(jobsEnv).configured &&
      [
        'LVBT_DEPLOYMENT_ENV',
        'LVBT_DISCORD_SYNC_ENABLED',
        'LVBT_DISCORD_APPLICATION_ID',
        'LVBT_DISCORD_GUILD_ID',
        'LVBT_DISCORD_PRODUCTION_GUILD_ID',
        'LVBT_DISCORD_MEMBER_ROLE_ID',
      ].every((name) => value(staff, name) === value(jobs, name)),
    'Enable matching Discord configuration on staff and jobs with separate preview and production servers.',
  );
}
