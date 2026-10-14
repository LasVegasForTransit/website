import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareStaffRelease } from './release-download';
import { verifyStaffRelease } from './release-artifact';
import { assertReleaseSource } from './release-source';
import { uploadStaffRelease, activateStaffRelease, inspectStaffRelease } from './release-deploy';
import { runWrangler } from './release-provider';
import { deploymentStep, DeploymentFailure } from './release-failure';
import { prepareStaffReceipt } from './release-recovery';
import { withReceiptLock } from './release-receipt';

type Action = 'upload' | 'activate' | 'inspect' | 'receipt';
type Values = Partial<
  Record<
    | 'directory'
    | 'repository'
    | 'run-id'
    | 'receipt'
    | 'target'
    | 'commit'
    | 'release-id'
    | 'stage'
    | 'source-directory'
    | 'deployment-run',
    string
  >
>;

function deploymentStage(value?: string) {
  if (value === undefined || value === 'launch') return 'launch' as const;
  if (value === 'setup') return 'setup' as const;
  throw new Error('Select --stage launch or --stage setup for the protected preview.');
}
function actionOptions(action: Action, values: Values) {
  if (action === 'receipt') {
    if (!values['deployment-run'] || values['source-directory'])
      throw new Error('Receipt retrieval requires --deployment-run and no source override.');
  } else if (values['deployment-run'] || (action === 'upload' && values['source-directory'])) {
    throw new Error('Only inspection and activation accept a selected source directory.');
  }
}
function selection(action: Action, values: Values) {
  actionOptions(action, values);
  if (
    !values.directory ||
    !values.repository ||
    !values['run-id'] ||
    !values.receipt ||
    values.target !== 'preview' ||
    values.commit ||
    values['release-id']
  )
    throw new Error(
      'Select a saved build, directory, receipt and preview target. Production promotion requires separate acceptance.',
    );
  return {
    directory: resolve(values.directory),
    repository: values.repository,
    runId: values['run-id'],
    receiptFile: resolve(values.receipt),
    stage: deploymentStage(values.stage),
    sourceDirectory: values['source-directory'],
    deploymentRun: values['deployment-run'],
  };
}
type Selection = ReturnType<typeof selection>;
function credentials(action: Action) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || (action !== 'receipt' && !token))
    throw new Error('Set explicit scoped Cloudflare deployment credentials.');
  return { accountId, token };
}
async function selectedBuild(choice: Selection, temporary: string) {
  const selected = await deploymentStep('saved-build', () =>
    prepareStaffRelease({
      directory: join(temporary, 'release'),
      repository: choice.repository,
      runId: choice.runId,
    }),
  );
  const saved = await deploymentStep('saved-artifact', () =>
    verifyStaffRelease(choice.directory, selected),
  );
  if (saved.artifactHash !== selected.artifactHash) throw new DeploymentFailure('saved-artifact');
  return { selected, saved };
}
export async function deployFromBuild(action: Action, values: Values) {
  const choice = selection(action, values);
  const { accountId, token } = credentials(action);
  const verifierRoot = resolve(import.meta.dirname, '../../..');
  const root = choice.sourceDirectory ? resolve(choice.sourceDirectory) : verifierRoot;
  const temporary = await mkdtemp(join(tmpdir(), 'lvbt-staff-build-'));
  try {
    const { selected, saved } = await selectedBuild(choice, temporary);
    if (action === 'receipt') {
      const runId = choice.deploymentRun;
      if (!runId) throw new DeploymentFailure('receipt');
      return await withReceiptLock(choice.directory, choice.receiptFile, () =>
        prepareStaffReceipt({
          repository: choice.repository,
          runId,
          filename: choice.receiptFile,
          release: saved,
          accountId,
          stage: choice.stage,
        }),
      );
    }
    if (!token) throw new DeploymentFailure('configuration');
    await deploymentStep('source-checkout', () => assertReleaseSource(root, selected.commit));
    const options = {
      root,
      accountId,
      token,
      environment: 'preview' as const,
      stage: choice.stage,
      run: async (args: string[], output: string) => {
        await deploymentStep('source-checkout', () => assertReleaseSource(root, selected.commit));
        await runWrangler(args, output, { accountId, token }, verifierRoot);
      },
    };
    const operation =
      action === 'upload'
        ? uploadStaffRelease
        : action === 'inspect'
          ? inspectStaffRelease
          : activateStaffRelease;
    const result = await operation(choice.directory, selected, choice.receiptFile, options);
    await deploymentStep('source-checkout', () => assertReleaseSource(root, selected.commit));
    return result;
  } catch (error) {
    throw error instanceof DeploymentFailure ? error : new DeploymentFailure('deployment');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
