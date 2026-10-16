import { writeFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { object } from './preflight-api';
import { validateIdentity, type StaffRelease } from './release-artifact';
import { releaseProvider, validateRepository, type ReleaseProvider } from './release-download';
import { digest } from './release-files';
import { deploymentStep } from './release-failure';
import { newReceipt, parseReceipt } from './release-receipt';
import type { Environment } from './preflight-config';

interface RecoveryOptions {
  repository: string;
  runId: string;
  filename: string;
  release: StaffRelease;
  accountId: string;
  stage: 'setup' | 'launch';
  environment?: Environment;
}
const WORKFLOWS: Partial<Record<string, { path: string; environment: Environment }>> = {
  'Deploy staff preview': {
    path: '.github/workflows/deploy-staff-preview.yml',
    environment: 'preview',
  },
  'Recover staff preview': {
    path: '.github/workflows/recover-staff-preview.yml',
    environment: 'preview',
  },
  'Deploy staff production': {
    path: '.github/workflows/deploy-staff-production.yml',
    environment: 'production',
  },
  'Recover staff production': {
    path: '.github/workflows/recover-staff-production.yml',
    environment: 'production',
  },
};
function deploymentOrigin(
  value: unknown,
  repository: string,
  runId: string,
  environment: Environment,
) {
  const run = object(value);
  const repo = validateRepository(run, repository);
  validateIdentity({ commit: String(run.head_sha), releaseId: runId });
  if (
    String(run.id) !== runId ||
    !Number.isSafeInteger(run.id) ||
    !Number.isSafeInteger(run.run_attempt) ||
    Number(run.run_attempt) < 1 ||
    WORKFLOWS[String(run.name)]?.path !== run.path ||
    WORKFLOWS[String(run.name)]?.environment !== environment ||
    run.event !== 'workflow_dispatch' ||
    run.head_branch !== 'main' ||
    run.status !== 'completed' ||
    !['success', 'failure', 'cancelled', 'timed_out'].includes(String(run.conclusion))
  )
    throw new Error('Select a completed protected deployment for the selected environment.');
  return { run, repo };
}
function receiptArtifact(
  values: unknown[],
  run: Record<string, unknown>,
  repo: Record<string, unknown>,
  environment: Environment,
) {
  const matches = values
    .map(object)
    .filter((artifact) => artifact.name === `staff-${environment}-deployment-${String(run.id)}`);
  if (matches.length !== 1) throw new Error('Select exactly one retained deployment receipt.');
  const artifact = matches[0];
  if (
    !Number.isSafeInteger(artifact.id) ||
    Number(artifact.id) < 1 ||
    artifact.expired !== false ||
    !/^sha256:[a-f0-9]{64}$/.test(String(artifact.digest)) ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    Number(artifact.size_in_bytes) < 1 ||
    Number(artifact.size_in_bytes) > 128 * 1024
  )
    throw new Error('Receipt artifact provenance is unavailable.');
  const origin = object(artifact.workflow_run);
  if (
    origin.id !== run.id ||
    origin.repository_id !== repo.id ||
    origin.head_repository_id !== repo.id ||
    origin.head_branch !== 'main' ||
    origin.head_sha !== run.head_sha
  )
    throw new Error('Receipt artifact belongs to another workflow source.');
  return artifact;
}
function receiptContent(archive: Uint8Array, artifact: Record<string, unknown>) {
  if (archive.length !== artifact.size_in_bytes || `sha256:${digest(archive)}` !== artifact.digest)
    throw new Error('Receipt archive differs from its recorded digest.');
  let count = 0;
  const files = unzipSync(archive, {
    filter(file) {
      if (
        ++count !== 1 ||
        file.name !== 'staff-deployment.json' ||
        file.originalSize < 1 ||
        file.originalSize > 64 * 1024
      )
        throw new Error('Invalid receipt archive.');
      return true;
    },
  });
  if (count !== 1 || !Object.hasOwn(files, 'staff-deployment.json'))
    throw new Error('Missing receipt.');
  const content = files['staff-deployment.json'];
  if (content.length > 64 * 1024) throw new Error('Receipt exceeds content limit.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)) as unknown;
}
/** Retrieves a complete, provider-recorded receipt; never infers missing upload results. */
export async function prepareStaffReceipt(
  options: RecoveryOptions,
  client: ReleaseProvider = releaseProvider,
) {
  return await deploymentStep('receipt', async () => {
    if (
      !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(options.repository) ||
      !/^[1-9][0-9]*$/.test(options.runId) ||
      !options.accountId
    )
      throw new Error('Invalid recovery selection.');
    const { run, repo } = deploymentOrigin(
      await client.run(options.repository, options.runId),
      options.repository,
      options.runId,
      options.environment ?? 'preview',
    );
    const artifact = receiptArtifact(
      await client.artifacts(options.repository, options.runId),
      run,
      repo,
      options.environment ?? 'preview',
    );
    const archive = await client.download(options.repository, String(artifact.id));
    const receipt = parseReceipt(
      receiptContent(archive, artifact),
      newReceipt(
        options.release,
        options.accountId,
        options.environment ?? 'preview',
        options.stage,
      ),
    );
    await writeFile(options.filename, `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    return receipt;
  });
}
