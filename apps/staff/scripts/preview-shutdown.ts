import { array, object, type MetadataClient } from './preflight-api';
import type { Check } from './preflight-config';
import { portableConfiguration } from './release-config';
import { inspectDiscord, value, type Bindings } from './preflight-workers';
import { discordProviderConfiguration } from '@lasvegasfortransit/platform-integrations/discord-runtime';
import { DISCORD_RUNTIME_CONFIG } from '@lasvegasfortransit/platform-integrations/worker-runtime-config';

const deferred = new Set(['source.discord.enabled', 'discord.configuration', 'jobs.schedule']);
const targetKeys = DISCORD_RUNTIME_CONFIG.map(({ name }) => name).filter(
  (name) => name !== 'LVBT_DISCORD_SYNC_ENABLED',
);

function disabledSource(config: Record<string, unknown>, app: string) {
  const vars = object(config.vars);
  const crons = object(config.triggers).crons;
  return (
    vars.LVBT_DEPLOYMENT_ENV === 'preview' &&
    vars.LVBT_DISCORD_SYNC_ENABLED === 'false' &&
    discordProviderConfiguration({ ...vars, LVBT_DISCORD_SYNC_ENABLED: 'true' }).configured &&
    (app !== 'jobs' ||
      (vars.LVBT_BEEHIIV_SYNC_ENABLED === 'false' && Array.isArray(crons) && crons.length === 0))
  );
}
function samePreviewTarget(
  bindings: Bindings,
  vars: Record<string, unknown>,
  disabledOnly: boolean,
) {
  return (
    targetKeys.every((key) => value(bindings, key) === vars[key]) &&
    (value(bindings, 'LVBT_BEEHIIV_SYNC_ENABLED') ?? 'false') === 'false' &&
    (value(bindings, 'LVBT_DISCORD_SYNC_ENABLED') === 'false' ||
      (!disabledOnly && inspectDiscord(bindings, bindings, 'preview').status === 'passed'))
  );
}
async function activeTarget(
  client: MetadataClient,
  config: Record<string, unknown>,
  disabledOnly: boolean,
) {
  const path = `/workers/scripts/${encodeURIComponent(String(config.name))}`;
  const active = array(object(await client.get(`${path}/deployments`)).deployments).at(0);
  const versions = array(active?.versions ?? []).filter(
    (version) => Number(version.percentage) > 0,
  );
  if (
    !versions.length ||
    versions.reduce((sum, version) => sum + Number(version.percentage), 0) !== 100
  )
    return false;
  for (const version of versions) {
    if (typeof version.version_id !== 'string') return false;
    const metadata = object(
      await client.get(`${path}/versions/${encodeURIComponent(version.version_id)}`),
    );
    if (
      !samePreviewTarget(
        array(object(metadata.resources).bindings),
        object(config.vars),
        disabledOnly,
      )
    )
      return false;
  }
  return true;
}

/** Allows only the recorded preview target to move from enabled to disabled provider work. */
export async function previewShutdownReady(
  root: string,
  client: MetadataClient,
  checks: Check[],
  disabledOnly = false,
) {
  if (
    checks.some(
      (check) =>
        check.status !== 'passed' && !(check.status === 'failed' && deferred.has(check.id)),
    )
  )
    return false;
  const [staff, jobs] = await Promise.all([
    portableConfiguration(root, 'staff', 'preview'),
    portableConfiguration(root, 'jobs', 'preview'),
  ]);
  const expected = object(staff.vars);
  for (const [app, config] of [
    ['staff', staff],
    ['jobs', jobs],
  ] as const) {
    if (
      !disabledSource(config, app) ||
      !targetKeys.every((key) => object(config.vars)[key] === expected[key])
    )
      return false;
    if (!(await activeTarget(client, config, disabledOnly))) return false;
  }
  return true;
}
