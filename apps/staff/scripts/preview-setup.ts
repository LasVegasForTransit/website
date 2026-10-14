import { array, object, type MetadataClient } from './preflight-api';
import type { Check } from './preflight-config';
import { portableConfiguration } from './release-config';
import { value, type Bindings } from './preflight-workers';

const deferred = new Set([
  'source.discord.enabled',
  'discord.configuration',
  'jobs.binding.LVBT_DISCORD_BOT_TOKEN',
  'jobs.schedule',
]);

export function setupBindings(bindings: Bindings) {
  return (
    value(bindings, 'LVBT_DEPLOYMENT_ENV') === 'preview' &&
    value(bindings, 'LVBT_DISCORD_SYNC_ENABLED') === 'false' &&
    bindings
      .filter((binding) => binding.name === 'LVBT_BEEHIIV_SYNC_ENABLED')
      .every((binding) => binding.type === 'plain_text' && binding.text === 'false')
  );
}

async function activeSetup(client: MetadataClient, path: string) {
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
    if (!setupBindings(array(object(metadata.resources).bindings))) return false;
  }
  return true;
}

export async function previewSetupReady(root: string, client: MetadataClient, checks: Check[]) {
  if (
    checks.some(
      (check) =>
        check.status !== 'passed' && !(check.status === 'failed' && deferred.has(check.id)),
    )
  )
    return false;
  for (const app of ['staff', 'jobs'] as const) {
    const config = await portableConfiguration(root, app, 'preview');
    const vars = object(config.vars);
    if (vars.LVBT_DEPLOYMENT_ENV !== 'preview' || vars.LVBT_DISCORD_SYNC_ENABLED !== 'false')
      return false;
    if (app === 'jobs' && vars.LVBT_BEEHIIV_SYNC_ENABLED !== 'false') return false;
    const path = `/workers/scripts/${encodeURIComponent(String(config.name))}`;
    if (!(await activeSetup(client, path))) return false;
    if (app === 'jobs') {
      const schedules = object(await client.get(`${path}/schedules`)).schedules;
      if (!Array.isArray(schedules) || schedules.length !== 0) return false;
    }
  }
  return true;
}
