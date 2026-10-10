import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyStaffRelease, type ReleaseIdentity } from './release-artifact';
import { portableConfiguration } from './release-config';
import { type Environment } from './preflight-config';
import { preflightStaff } from './preflight';
import { MetadataClient, object } from './preflight-api';
import {
  activeDeployment,
  providerOutput,
  releaseMessage,
  runWrangler,
  verifyVersion,
  versionTraffic,
  recordedTransition,
} from './release-provider';
import {
  newReceipt,
  readReceipt,
  saveReceipt,
  uuid,
  withReceiptLock,
  workerName,
  type DeploymentReceipt,
  type WorkerReceipt,
} from './release-receipt';

export interface DeploymentOptions {
  root: string;
  environment: Environment;
  accountId: string;
  token: string;
  fetch?: typeof fetch;
  run?: (args: string[], output: string) => Promise<void>;
}
async function ready(options: DeploymentOptions, receipt?: DeploymentReceipt) {
  if (
    !options.accountId ||
    !options.token ||
    !['preview', 'production'].includes(options.environment)
  )
    throw new Error('Select an environment and explicit scoped deployment credentials.');
  const report = await preflightStaff(options.environment, options);
  const failures = report.checks.filter((check) => check.status !== 'passed');
  const transition = receipt
    ? await recordedTransition(new MetadataClient(options), receipt)
    : null;
  if (
    (receipt && !transition?.valid) ||
    (failures.length &&
      !(
        transition?.selectedActive &&
        failures.every((check) => check.id === 'discord.configuration' && check.status === 'failed')
      ))
  )
    throw new Error(
      'Deployment requires verified configuration, existing Workers and applied migrations. Run staff:preflight.',
    );
}
async function withRelease<T>(
  directory: string,
  identity: ReleaseIdentity,
  options: DeploymentOptions,
  run: (copy: string, receipt: DeploymentReceipt) => Promise<T>,
) {
  const release = await verifyStaffRelease(directory, identity);
  const temporary = await mkdtemp(join(tmpdir(), 'lvbt-staff-deploy-'));
  try {
    const copy = join(temporary, 'release');
    await cp(directory, copy, { recursive: true });
    await verifyStaffRelease(copy, identity);
    for (const app of ['staff', 'jobs'] as const) {
      const config = JSON.parse(
        await readFile(join(copy, app, `wrangler.${options.environment}.json`), 'utf8'),
      ) as unknown;
      if (
        JSON.stringify(config) !==
          JSON.stringify(await portableConfiguration(options.root, app, options.environment)) ||
        object(config).name !== workerName(app, options.environment)
      )
        throw new Error('Saved configuration differs from the selected source.');
    }
    return await run(copy, newReceipt(release, options.accountId, options.environment));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
async function command(
  context: { copy: string; receipt: DeploymentReceipt },
  app: 'staff' | 'jobs',
  action: string[],
  options: DeploymentOptions,
) {
  const { copy, receipt } = context;
  const output = join(copy, `${app}-${action[0]}.jsonl`);
  await rm(output, { force: true });
  const config = join(copy, app, `wrangler.${options.environment}.json`);
  const args = ['versions', ...action, '--config', config, '--message', releaseMessage(receipt)];
  await (options.run ?? ((args, file) => runWrangler(args, file, options, options.root)))(
    args,
    output,
  );
  return { output, config: object(JSON.parse(await readFile(config, 'utf8'))) };
}
export async function uploadStaffRelease(
  directory: string,
  identity: ReleaseIdentity,
  file: string,
  options: DeploymentOptions,
) {
  return await withReceiptLock(
    directory,
    file,
    async () =>
      await withRelease(directory, identity, options, async (copy, receipt) => {
        await ready(options);
        await writeFile(file, `${JSON.stringify(receipt)}\n`, { flag: 'wx', mode: 0o600 });
        try {
          const client = new MetadataClient(options);
          for (const app of ['staff', 'jobs'] as const) {
            await ready(options);
            const previousVersions = await versionTraffic(
              client,
              workerName(app, options.environment),
            );
            const { output, config } = await command(
              { copy, receipt },
              app,
              ['upload', '--no-bundle'],
              options,
            );
            const result = await providerOutput(
              output,
              'version-upload',
              workerName(app, options.environment),
            );
            if (!uuid(result.version_id))
              throw new Error('Actual uploaded version ID unavailable.');
            const worker: WorkerReceipt = {
              app,
              name: workerName(app, options.environment),
              versionId: result.version_id,
              active: false,
              previousVersions,
            };
            receipt.workers.push(worker);
            await saveReceipt(file, receipt);
            await verifyVersion(client, worker, receipt, config);
          }
          receipt.status = 'uploaded';
          await saveReceipt(file, receipt);
          return receipt;
        } catch {
          receipt.status = 'failed';
          await saveReceipt(file, receipt);
          throw new Error(
            'Upload failed. Inspect the retained receipt and provider state before retrying.',
          );
        }
      }),
  );
}
async function activateWorker(
  context: { copy: string; receipt: DeploymentReceipt; client: MetadataClient; file: string },
  worker: WorkerReceipt,
  options: DeploymentOptions,
) {
  const { copy, receipt, client, file } = context;
  const current = await activeDeployment(client, worker);
  if (current) {
    worker.active = true;
    worker.deploymentId = current;
    await saveReceipt(file, receipt);
    return;
  }
  if (worker.active || worker.deploymentId)
    throw new Error('Previously activated release has changed; inspect provider state.');
  await ready(options, receipt);
  const { output } = await command(
    { copy, receipt },
    worker.app,
    ['deploy', `${worker.versionId}@100%`, '--yes'],
    options,
  );
  const result = await providerOutput(output, 'version-deploy', worker.name);
  // Wrangler currently serializes its traffic Map as {}; authoritative traffic comes from readback.
  if (!uuid(result.deployment_id)) throw new Error('Actual deployment receipt unavailable.');
  // Retain the acknowledged deployment even when the following readback is unavailable.
  worker.deploymentId = result.deployment_id;
  await saveReceipt(file, receipt);
  if ((await activeDeployment(client, worker)) !== worker.deploymentId)
    throw new Error('Deployment readback differs.');
  worker.active = true;
  await saveReceipt(file, receipt);
}
export async function activateStaffRelease(
  directory: string,
  identity: ReleaseIdentity,
  file: string,
  options: DeploymentOptions,
) {
  return await withReceiptLock(
    directory,
    file,
    async () =>
      await withRelease(directory, identity, options, async (copy, expected) => {
        const receipt = await readReceipt(file, expected);
        try {
          const client = new MetadataClient(options);
          for (const worker of receipt.workers) {
            const config = object(
              JSON.parse(
                await readFile(
                  join(copy, worker.app, `wrangler.${options.environment}.json`),
                  'utf8',
                ),
              ),
            );
            await verifyVersion(client, worker, receipt, config);
          }
          await ready(options, receipt);
          receipt.status = 'activating';
          await saveReceipt(file, receipt);
          for (const worker of receipt.workers)
            await activateWorker({ copy, receipt, client, file }, worker, options);
          receipt.status = 'active';
          await saveReceipt(file, receipt);
          return receipt;
        } catch {
          receipt.status = 'failed';
          await saveReceipt(file, receipt);
          throw new Error(
            'Activation failed. Confirm provider state and resume with the same receipt.',
          );
        }
      }),
  );
}
