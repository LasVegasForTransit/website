import { log } from '@clack/prompts';
import pc from 'picocolors';
import { listWorkerDeployments } from '../lib/cloudflare-api.js';
import { ensureCloudflareAccount } from '../lib/cloudflare.js';
import { DEFAULT_WORKER_NAME } from '../lib/defaults.js';
import { rt } from '../lib/runtime.js';
import { runCommand, runStreamingCommand, summarizeOutputLine } from '../lib/shell.js';
import { promptConfirm } from '../lib/ui.js';
import type { FollowUp, PhaseResult } from '../lib/types.js';
import type { DeployOptions } from './deploy.js';

type DeploymentState = 'deployed' | 'missing' | 'unknown';

function savedCloudflareAccount(): string | undefined {
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- local bootstrap account choice.
  return process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
}

async function deploymentState(projectRoot: string, doctorMode: boolean): Promise<DeploymentState> {
  const result = runCommand(`wrangler deployments list --name ${DEFAULT_WORKER_NAME} --json`, {
    cwd: projectRoot,
  });
  if (!result.ok) {
    const accountId = doctorMode
      ? savedCloudflareAccount()
      : (await ensureCloudflareAccount(projectRoot)).accountId;
    // eslint-disable-next-line turbo/no-undeclared-env-vars -- local bootstrap credential.
    const token = rt().wranglerOAuthToken() ?? process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !token) return 'unknown';
    const response = await listWorkerDeployments(accountId, DEFAULT_WORKER_NAME, token);
    if (response.status === 404) return 'missing';
    if (!response.ok || !response.data) return 'unknown';
    return response.data.deployments.length > 0 ? 'deployed' : 'missing';
  }
  try {
    const deployments = JSON.parse(result.stdout) as unknown;
    return Array.isArray(deployments) && deployments.length > 0 ? 'deployed' : 'missing';
  } catch {
    return 'unknown';
  }
}

export async function runWorkerDeployPhase(
  projectRoot: string,
  doctorMode: boolean,
  options: DeployOptions = {},
): Promise<PhaseResult> {
  const followUpItems: FollowUp[] = [];
  const state = await deploymentState(projectRoot, doctorMode);
  if (state === 'deployed' && (doctorMode || !options.redeploy)) {
    log.success(`Production Worker ${pc.cyan(DEFAULT_WORKER_NAME)} is deployed.`);
    return { success: true, followUpItems };
  }
  if (state === 'unknown') {
    followUpItems.push({
      kind: 'auth',
      message:
        'Check Wrangler access to the production Worker, then rerun `pnpm bootstrap --phase deploy`.',
    });
    return { success: false, followUpItems };
  }
  if (doctorMode) {
    followUpItems.push({
      kind: 'remote',
      message: 'Deploy the production Worker with `pnpm bootstrap --phase deploy`.',
    });
    return { success: false, followUpItems };
  }

  const confirmed = await promptConfirm(
    'deploy.proceed-worker',
    state === 'missing'
      ? 'Build and deploy the production Worker now?'
      : 'Build and redeploy this checkout to the production Worker?',
    state === 'missing',
  );
  if (!confirmed) {
    followUpItems.push({
      kind: 'remote',
      message: 'Deploy the production Worker with `pnpm bootstrap --phase deploy`.',
    });
    return { success: false, followUpItems };
  }

  const result = await runStreamingCommand('pnpm worker:deploy', { cwd: projectRoot });
  if (!result.ok || (await deploymentState(projectRoot, false)) !== 'deployed') {
    log.error(`Worker deployment failed: ${summarizeOutputLine(result)}`);
    followUpItems.push({
      kind: 'remote',
      message: 'Resolve the Worker deployment error, then rerun `pnpm bootstrap --phase deploy`.',
    });
    return { success: false, followUpItems };
  }
  log.success(`Production Worker ${pc.cyan(DEFAULT_WORKER_NAME)} is deployed.`);
  return { success: true, followUpItems };
}
