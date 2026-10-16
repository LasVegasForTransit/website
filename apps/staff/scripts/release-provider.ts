import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { array, type MetadataClient, object } from './preflight-api';
import { STAFF_WORKER_BINDINGS } from '@lasvegasfortransit/platform-integrations/worker-runtime-config';
import {
  uuid,
  validateTraffic,
  type WorkerReceipt,
  type DeploymentReceipt,
} from './release-receipt';
import {
  disabledProviderBindings,
  inspectDiscord,
  newsletterBindingsReady,
} from './preflight-workers';
import { setupBindings } from './preview-setup';
import type { DeploymentOptions } from './release-deploy';
import { ReleaseDiagnosticError } from './release-diagnostics';

const execute = promisify(execFile);
export function assertDeploymentOptions(options: DeploymentOptions) {
  if (
    !options.accountId ||
    !options.token ||
    !['preview', 'production'].includes(options.environment) ||
    (options.stage !== undefined && !['setup', 'launch', 'shutdown'].includes(options.stage)) ||
    (options.stage !== undefined && options.stage !== 'launch' && options.environment !== 'preview')
  )
    throw new Error('Select an environment and explicit scoped deployment credentials.');
}
export function releaseMessage(receipt: DeploymentReceipt) {
  return `Release ${receipt.releaseId} ${receipt.commit} ${receipt.artifactHash}`;
}
export async function runWrangler(
  args: string[],
  output: string,
  credentials: { accountId: string; token: string },
  root: string,
) {
  await execute('pnpm', ['exec', 'wrangler', ...args], {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: credentials.accountId,
      CLOUDFLARE_API_TOKEN: credentials.token,
      WRANGLER_OUTPUT_FILE_PATH: output,
    },
  });
}
export async function providerOutput(
  file: string,
  type: 'version-upload' | 'version-deploy',
  name: string,
) {
  const text = await readFile(file, 'utf8');
  if (text.length > 1024 * 1024) throw new Error('Provider receipt too large.');
  const rows = text
    .split('\n')
    .filter(Boolean)
    .map((line) => object(JSON.parse(line)));
  const selected = rows.filter((row) => row.type === type);
  if (selected.length !== 1 || selected[0].version !== 1 || selected[0].worker_name !== name)
    throw new Error('Provider receipt unavailable.');
  return selected[0];
}
export function workerPath(worker: WorkerReceipt) {
  return `/workers/scripts/${encodeURIComponent(worker.name)}`;
}
function serviceBindingsMatch(
  bindings: Record<string, unknown>[],
  config: Record<string, unknown>,
): boolean {
  return array(config.services ?? []).every((service) =>
    bindings.some(
      (binding) =>
        binding.type === 'service' &&
        binding.name === service.binding &&
        binding.service === service.service,
    ),
  );
}
function requiredBindingChecks(
  bindings: Record<string, unknown>[],
  worker: WorkerReceipt,
  receipt: DeploymentReceipt,
) {
  return STAFF_WORKER_BINDINGS[worker.app]
    .filter(
      (name) =>
        !(
          receipt.stage === 'setup' &&
          receipt.environment === 'preview' &&
          name === 'LVBT_DISCORD_BOT_TOKEN'
        ),
    )
    .map(
      (name) =>
        [
          `version.binding.${name}`,
          bindings.some(
            (binding) =>
              binding.name === name &&
              (binding.type === 'secret_text' ||
                ([
                  'LVBT_ACCESS_AUD',
                  'LVBT_ACCESS_TEAM_DOMAIN',
                  'LVBT_GOOGLE_OAUTH_CLIENT_ID',
                ].includes(name) &&
                  binding.type === 'plain_text' &&
                  Boolean(binding.text))),
          ),
        ] as const,
    );
}
export async function verifyVersion(
  client: MetadataClient,
  worker: WorkerReceipt,
  receipt: DeploymentReceipt,
  config: Record<string, unknown>,
) {
  const version = object(await client.get(`${workerPath(worker)}/versions/${worker.versionId}`));
  let bindings: Record<string, unknown>[];
  try {
    bindings = array(object(version.resources).bindings);
  } catch {
    throw new ReleaseDiagnosticError([{ id: 'version.metadata', status: 'unverified' }]);
  }
  const database = array(config.d1_databases).find((db) => db.binding === 'PLATFORM_DB');
  const vars = object(config.vars);
  const checks = [
    ['version.id', version.id === worker.versionId],
    [
      'version.annotation',
      object(version.annotations)['workers/message'] === releaseMessage(receipt),
    ],
    ['version.services', serviceBindingsMatch(bindings, config)],
    [
      'version.database',
      bindings.some(
        (binding) =>
          binding.type === 'd1' &&
          binding.name === 'PLATFORM_DB' &&
          binding.id === database?.database_id,
      ),
    ],
    ...Object.entries(vars).map(
      ([name, text]) =>
        [
          `version.variable.${name}`,
          bindings.some(
            (binding) =>
              binding.name === name && binding.type === 'plain_text' && binding.text === text,
          ),
        ] as const,
    ),
    ...requiredBindingChecks(bindings, worker, receipt),
    [
      'version.forbidden_bindings',
      !(
        worker.app === 'staff' &&
        bindings.some((binding) =>
          ['LVBT_DISCORD_BOT_TOKEN', 'LVBT_BEEHIIV_API_KEY', 'LVBT_NEWSLETTER_INTENT_KEY'].includes(
            String(binding.name),
          ),
        )
      ),
    ],
    [
      'version.newsletter',
      worker.app !== 'jobs' || newsletterBindingsReady(bindings, receipt.environment),
    ],
  ] as const;
  const failed = checks.filter(([, passed]) => !passed).map(([id]) => ({ id, status: 'failed' }));
  if (failed.length) throw new ReleaseDiagnosticError(failed);
}
export async function activeDeployment(client: MetadataClient, worker: WorkerReceipt) {
  const latest = array(
    object(await client.get(`${workerPath(worker)}/deployments`)).deployments,
  ).at(0);
  const versions = array(latest?.versions ?? []);
  return latest &&
    uuid(latest.id) &&
    versions.length === 1 &&
    versions[0].version_id === worker.versionId &&
    versions[0].percentage === 100
    ? latest.id
    : undefined;
}
export async function versionTraffic(client: MetadataClient, name: string) {
  const deployment = array(
    object(await client.get(`/workers/scripts/${encodeURIComponent(name)}/deployments`))
      .deployments,
  ).at(0);
  return validateTraffic(
    array(deployment?.versions ?? [])
      .filter((row) => Number(row.percentage) > 0)
      .map((row) => ({
        versionId: row.version_id,
        percentage: row.percentage,
      })),
  );
}
export async function recordedTransition(client: MetadataClient, receipt: DeploymentReceipt) {
  let selectedActive = false;
  for (const worker of receipt.workers) {
    const traffic = await versionTraffic(client, worker.name);
    const selected =
      traffic.length === 1 &&
      traffic[0].versionId === worker.versionId &&
      traffic[0].percentage === 100;
    if (!selected && JSON.stringify(traffic) !== JSON.stringify(worker.previousVersions))
      return { valid: false, selectedActive };
    selectedActive ||= selected;
    for (const row of traffic) {
      const version = object(await client.get(`${workerPath(worker)}/versions/${row.versionId}`));
      const bindings = array(object(version.resources).bindings);
      if (
        receipt.stage === 'setup'
          ? receipt.environment !== 'preview' || !setupBindings(bindings)
          : !disabledProviderBindings(bindings, receipt.environment) &&
            inspectDiscord(bindings, bindings, receipt.environment).status !== 'passed'
      )
        return { valid: false, selectedActive };
    }
  }
  return { valid: true, selectedActive };
}
