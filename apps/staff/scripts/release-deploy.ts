import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyStaffRelease, type ReleaseIdentity } from './release-artifact';
import { portableConfiguration } from './release-config';
import { type Environment } from './preflight-config';
import { preflightStaff } from './preflight';
import { MetadataClient, object } from './preflight-api';
import { previewSetupReady } from './preview-setup';
import { previewShutdownReady } from './preview-shutdown';
import { disabledDeployment } from './preflight-workers';
import {
  applySavedSchedule,
  captureSchedule,
  productionReleaseAllowed,
  readJobsSchedule,
  scheduleUnchanged,
  sameSchedule,
  verifySavedSchedule,
} from './release-schedule';
import { deploymentStep, DeploymentFailure } from './release-failure';
import {
  activeDeployment,
  providerOutput,
  releaseMessage,
  runWrangler,
  verifyVersion,
  versionTraffic,
  recordedTransition,
  assertDeploymentOptions,
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
  type ReleaseStage,
} from './release-receipt';

export interface DeploymentOptions {
  root: string;
  environment: Environment;
  stage?: ReleaseStage;
  accountId: string;
  token: string;
  fetch?: typeof fetch;
  run?: (args: string[], output: string) => Promise<void>;
  assertSource?: () => Promise<void>;
}
async function previewBoundary(
  options: DeploymentOptions,
  client: MetadataClient,
  checks: Awaited<ReturnType<typeof preflightStaff>>['checks'],
  state: { currentSchedule: string[]; final: boolean },
) {
  if (options.stage === 'setup') {
    if (
      !(await deploymentStep('setup-boundary', () =>
        previewSetupReady(options.root, client, checks),
      ))
    )
      throw new DeploymentFailure('setup-boundary');
    return true;
  }
  if (options.stage === 'shutdown') {
    if (
      !(await deploymentStep('shutdown-boundary', () =>
        previewShutdownReady(options.root, client, checks, state.final),
      ))
    )
      throw new DeploymentFailure('shutdown-boundary');
    if (state.final && state.currentSchedule.length !== 0)
      throw new DeploymentFailure('jobs.schedule');
    return true;
  }
  return false;
}
async function ready(options: DeploymentOptions, receipt?: DeploymentReceipt, final = false) {
  assertDeploymentOptions(options);
  await productionReleaseAllowed(options);
  const report = await deploymentStep('configuration', () =>
    preflightStaff(options.environment, options),
  );
  const client = new MetadataClient(options);
  const transition = receipt
    ? await deploymentStep('recorded-traffic', () =>
        recordedTransition(new MetadataClient(options), receipt),
      )
    : null;
  if (receipt && !transition?.valid) throw new DeploymentFailure('recorded-traffic');
  const currentSchedule = await deploymentStep('jobs.schedule', () =>
    readJobsSchedule(client, workerName('jobs', options.environment)),
  );
  if (receipt) await deploymentStep('jobs.schedule', () => scheduleUnchanged(client, receipt));
  if (await previewBoundary(options, client, report.checks, { currentSchedule, final })) return;
  const disabled =
    !final &&
    (await deploymentStep('configuration', () =>
      disabledDeployment(
        client,
        [workerName('staff', options.environment), workerName('jobs', options.environment)],
        options.environment,
      ),
    ));
  const failures = report.checks.filter(
    (check) =>
      check.status !== 'passed' &&
      !(
        !final &&
        check.status === 'failed' &&
        (check.id === 'jobs.schedule' ||
          (check.id === 'discord.configuration' && (disabled || transition?.selectedActive)))
      ),
  );
  if (final && receipt?.schedule && !sameSchedule(currentSchedule, receipt.schedule.desired))
    throw new DeploymentFailure('jobs.schedule');
  if (failures.length) throw new DeploymentFailure('configuration');
}
async function withRelease<T>(
  directory: string,
  identity: ReleaseIdentity,
  options: DeploymentOptions,
  run: (copy: string, receipt: DeploymentReceipt) => Promise<T>,
) {
  assertDeploymentOptions(options);
  const release = await deploymentStep('saved-artifact', () =>
    verifyStaffRelease(directory, identity),
  );
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
        throw new DeploymentFailure('saved-configuration');
    }
    return await run(
      copy,
      newReceipt(release, options.accountId, options.environment, options.stage),
    );
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
  await productionReleaseAllowed(options);
  return await withReceiptLock(
    directory,
    file,
    async () =>
      await withRelease(directory, identity, options, async (copy, receipt) => {
        await ready(options);
        receipt.schedule = await deploymentStep('jobs.schedule', () =>
          captureSchedule(copy, options),
        );
        await writeFile(file, `${JSON.stringify(receipt)}\n`, { flag: 'wx', mode: 0o600 });
        try {
          const client = new MetadataClient(options);
          for (const app of ['staff', 'jobs'] as const) {
            await ready(options);
            const previousVersions = await versionTraffic(
              client,
              workerName(app, options.environment),
            );
            const { output, config } = await deploymentStep(`${app}.upload`, () =>
              command({ copy, receipt }, app, ['upload', '--no-bundle'], options),
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
            await deploymentStep(`${app}.version`, () =>
              verifyVersion(client, worker, receipt, config),
            );
          }
          receipt.status = 'uploaded';
          await saveReceipt(file, receipt);
          return receipt;
        } catch (error) {
          receipt.status = 'failed';
          await saveReceipt(file, receipt);
          throw error instanceof DeploymentFailure ? error : new DeploymentFailure('deployment');
        }
      }),
  );
}
async function activationCheckpoint(client: MetadataClient, worker: WorkerReceipt) {
  const current = await deploymentStep(`${worker.app}.readback`, () =>
    activeDeployment(client, worker),
  );
  if (!current && (worker.active || worker.deploymentId))
    throw new DeploymentFailure(`${worker.app}.readback`);
  return current;
}

async function activateWorker(
  context: { copy: string; receipt: DeploymentReceipt; client: MetadataClient; file: string },
  worker: WorkerReceipt,
  options: DeploymentOptions,
) {
  const { copy, receipt, client, file } = context;
  const current = await activationCheckpoint(client, worker);
  if (current) {
    worker.active = true;
    worker.deploymentId = current;
    await saveReceipt(file, receipt);
    return;
  }
  await ready(options, receipt);
  const { output } = await deploymentStep(`${worker.app}.activation`, () =>
    command(
      { copy, receipt },
      worker.app,
      ['deploy', `${worker.versionId}@100%`, '--yes'],
      options,
    ),
  );
  const result = await deploymentStep(`${worker.app}.readback`, () =>
    providerOutput(output, 'version-deploy', worker.name),
  );
  // Wrangler currently serializes its traffic Map as {}; authoritative traffic comes from readback.
  if (!uuid(result.deployment_id)) throw new DeploymentFailure(`${worker.app}.readback`);
  // Retain the acknowledged deployment even when the following readback is unavailable.
  worker.deploymentId = result.deployment_id;
  await saveReceipt(file, receipt);
  if (
    (await deploymentStep(`${worker.app}.readback`, () => activeDeployment(client, worker))) !==
    worker.deploymentId
  )
    throw new DeploymentFailure(`${worker.app}.readback`);
  worker.active = true;
  await saveReceipt(file, receipt);
}
/** Reads the exact activation gates without writing a receipt or sending deployment commands. */
export async function inspectStaffRelease(
  directory: string,
  identity: ReleaseIdentity,
  file: string,
  options: DeploymentOptions,
) {
  assertDeploymentOptions(options);
  return await withRelease(directory, identity, options, async (copy, expected) => {
    const receipt = await deploymentStep('receipt', () => readReceipt(file, expected));
    await verifySavedSchedule(copy, receipt);
    const checks: { stage: string; passed: boolean }[] = [];
    for (const worker of receipt.workers) {
      try {
        const config = object(
          JSON.parse(
            await readFile(join(copy, worker.app, `wrangler.${options.environment}.json`), 'utf8'),
          ),
        );
        await deploymentStep(`${worker.app}.version`, () =>
          verifyVersion(new MetadataClient(options), worker, receipt, config),
        );
        await activationCheckpoint(new MetadataClient(options), worker);
        checks.push({ stage: `${worker.app}.version`, passed: true });
      } catch (error) {
        checks.push({
          stage: error instanceof DeploymentFailure ? error.stage : 'saved-configuration',
          passed: false,
        });
      }
    }
    const report = await deploymentStep('configuration', () =>
      preflightStaff(options.environment, options),
    );
    try {
      await ready(options, receipt);
      checks.push({ stage: 'configuration', passed: true });
    } catch (error) {
      checks.push({
        stage: error instanceof DeploymentFailure ? error.stage : 'configuration',
        passed: false,
      });
    }
    return {
      environment: options.environment,
      stage: receipt.stage,
      ready: checks.every((check) => check.passed),
      checks,
      configuration: report.checks,
    };
  });
}

async function activeConfigurationReady(
  client: MetadataClient,
  receipt: DeploymentReceipt,
  options: DeploymentOptions,
) {
  for (const worker of receipt.workers) {
    if (!(await activationCheckpoint(client, worker)))
      throw new DeploymentFailure('recorded-traffic');
  }
  const report = await preflightStaff(options.environment, options);
  if (options.stage === 'shutdown') {
    if (!(await previewShutdownReady(options.root, client, report.checks, true)))
      throw new DeploymentFailure('shutdown-boundary');
  } else if (options.stage === 'setup') {
    if (!(await previewSetupReady(options.root, client, report.checks)))
      throw new DeploymentFailure('setup-boundary');
  } else if (
    report.checks.some(
      (check) =>
        check.status !== 'passed' && !(check.id === 'jobs.schedule' && check.status === 'failed'),
    )
  ) {
    throw new DeploymentFailure('configuration');
  }
}

export async function activateStaffRelease(
  directory: string,
  identity: ReleaseIdentity,
  file: string,
  options: DeploymentOptions,
) {
  await productionReleaseAllowed(options);
  return await withReceiptLock(
    directory,
    file,
    async () =>
      await withRelease(directory, identity, options, async (copy, expected) => {
        const receipt = await deploymentStep('receipt', () => readReceipt(file, expected));
        await verifySavedSchedule(copy, receipt);
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
            await deploymentStep(`${worker.app}.version`, () =>
              verifyVersion(client, worker, receipt, config),
            );
          }
          await ready(options, receipt);
          receipt.status = 'activating';
          await saveReceipt(file, receipt);
          for (const worker of receipt.workers)
            await activateWorker({ copy, receipt, client, file }, worker, options);
          await applySavedSchedule(receipt, file, options, () =>
            activeConfigurationReady(client, receipt, options),
          );
          await ready(options, receipt, true);
          receipt.status = 'active';
          await saveReceipt(file, receipt);
          return receipt;
        } catch (error) {
          receipt.status = 'failed';
          await saveReceipt(file, receipt);
          throw error instanceof DeploymentFailure ? error : new DeploymentFailure('deployment');
        }
      }),
  );
}
