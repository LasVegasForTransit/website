import { array, object, type MetadataClient } from './preflight-api';
import type { Check } from './preflight-config';
import { portableConfiguration } from './release-config';
import { value, type Bindings } from './preflight-workers';
import { ReleaseDiagnosticError } from './release-diagnostics';
import { DeploymentFailure, deploymentStep } from './release-failure';

const deferred = new Set([
  'staff.newsletter_service',
  'source.discord.enabled',
  'discord.configuration',
  'jobs.binding.LVBT_DISCORD_BOT_TOKEN',
  'jobs.schedule',
]);

export function setupBindings(bindings: Bindings) {
  return (
    value(bindings, 'LVBT_DEPLOYMENT_ENV') === 'preview' &&
    value(bindings, 'LVBT_DISCORD_SYNC_ENABLED') === 'false' &&
    (value(bindings, 'LVBT_TASK_CHECKINS_ENABLED') ?? 'false') === 'false' &&
    (value(bindings, 'LVBT_DISCORD_WORK_ENABLED') ?? 'false') === 'false' &&
    bindings
      .filter((binding) => binding.name === 'LVBT_BEEHIIV_SYNC_ENABLED')
      .every((binding) => binding.type === 'plain_text' && binding.text === 'false')
  );
}

function notReady(checks: Pick<Check, 'id' | 'status' | 'diagnostics'>[], diagnose: boolean) {
  if (diagnose)
    throw new ReleaseDiagnosticError(
      checks,
      checks.find((check) => check.diagnostics)?.diagnostics,
    );
  return false;
}
async function setupVersionBindings(
  client: MetadataClient,
  path: string,
  app: string,
  diagnose: boolean,
) {
  const metadata = object(await client.get(path));
  try {
    return array(object(metadata.resources).bindings);
  } catch (error) {
    if (diagnose)
      throw new ReleaseDiagnosticError([
        { id: `setup.${app}.version_metadata`, status: 'unverified' },
      ]);
    throw error;
  }
}
async function activeSetup(client: MetadataClient, path: string, app: string, diagnose: boolean) {
  const active = array(object(await client.get(`${path}/deployments`)).deployments).at(0);
  const versions = array(active?.versions ?? []).filter(
    (version) => Number(version.percentage) > 0,
  );
  if (
    !versions.length ||
    versions.reduce((sum, version) => sum + Number(version.percentage), 0) !== 100
  )
    return notReady([{ id: `setup.${app}.traffic`, status: 'failed' }], diagnose);
  for (const version of versions) {
    if (typeof version.version_id !== 'string')
      return notReady([{ id: `setup.${app}.version_metadata`, status: 'unverified' }], diagnose);
    const bindings = await setupVersionBindings(
      client,
      `${path}/versions/${encodeURIComponent(version.version_id)}`,
      app,
      diagnose,
    );
    if (!setupBindings(bindings))
      return notReady([{ id: `setup.${app}.disabled`, status: 'failed' }], diagnose);
  }
  return true;
}

async function setupSchedule(client: MetadataClient, path: string, diagnose: boolean) {
  const schedules = object(await client.get(`${path}/schedules`)).schedules;
  return Array.isArray(schedules) && schedules.length === 0
    ? true
    : notReady(
        [{ id: 'setup.jobs.schedule', status: Array.isArray(schedules) ? 'failed' : 'unverified' }],
        diagnose,
      );
}
export async function previewSetupReady(
  root: string,
  client: MetadataClient,
  checks: Check[],
  diagnose = false,
) {
  const blocking = checks.filter(
    (check) => check.status !== 'passed' && !(check.status === 'failed' && deferred.has(check.id)),
  );
  if (blocking.length) return notReady(blocking, diagnose);
  for (const app of ['staff', 'jobs'] as const) {
    const config = await portableConfiguration(root, app, 'preview');
    const vars = object(config.vars);
    if (
      vars.LVBT_DEPLOYMENT_ENV !== 'preview' ||
      vars.LVBT_DISCORD_SYNC_ENABLED !== 'false' ||
      (vars.LVBT_DISCORD_WORK_ENABLED ?? 'false') !== 'false' ||
      (vars.LVBT_TASK_CHECKINS_ENABLED ?? 'false') !== 'false'
    )
      return notReady([{ id: `setup.${app}.source`, status: 'failed' }], diagnose);
    if (app === 'jobs' && vars.LVBT_BEEHIIV_SYNC_ENABLED !== 'false')
      return notReady([{ id: 'setup.jobs.source', status: 'failed' }], diagnose);
    const path = `/workers/scripts/${encodeURIComponent(String(config.name))}`;
    if (!(await activeSetup(client, path, app, diagnose))) return false;
    if (app === 'jobs' && !(await setupSchedule(client, path, diagnose))) return false;
  }
  return true;
}
export async function assertPreviewSetupReady(
  root: string,
  client: MetadataClient,
  checks: Check[],
) {
  return await deploymentStep('setup-boundary', async () => {
    if (!(await previewSetupReady(root, client, checks, true)))
      throw new DeploymentFailure('setup-boundary');
    return true;
  });
}
