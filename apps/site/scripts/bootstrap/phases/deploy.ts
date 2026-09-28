import path from 'node:path';
import { existsSync } from 'node:fs';
import { log, note, spinner, taskLog } from '@clack/prompts';
import pc from 'picocolors';
import type { FollowUp, PhaseResult } from '../lib/types.js';
import { runCommand, runStreamingCommand, shellEscape, summarizeOutputLine } from '../lib/shell.js';
import { promptConfirm, logSubline } from '../lib/ui.js';
import { rt } from '../lib/runtime.js';
import { ensureCloudflareAccount } from '../lib/cloudflare.js';
import { mergeEnvFile } from '../lib/env-file.js';
import { validatePagesProjectName, validateGitBranch } from '../lib/validators.js';
import { DEFAULT_PAGES_PROJECT, DEFAULT_PRODUCTION_BRANCH } from '../lib/defaults.js';
import { CF_ERROR, getPagesProject } from '../lib/cloudflare-api.js';

export interface DeployOptions {
  /** Push ./dist to production even when a production deployment already exists. */
  redeploy?: boolean;
}

/** What Cloudflare says about the Pages project, checked before anything is changed. */
type PagesState =
  | { kind: 'missing' }
  | { kind: 'empty' }
  | { kind: 'deployed'; url?: string; createdOn?: string }
  | { kind: 'unknown'; detail: string };

/**
 * Does the project exist, and does it have a production deployment? Asks the
 * Cloudflare API with wrangler's sign-in first. When that sign-in can't be
 * read, falls back to wrangler's own production deployment list, which
 * cannot tell "no project" from "no access", so that case stays unknown.
 */
async function readPagesState(accountId: string | undefined, project: string): Promise<PagesState> {
  const token = rt().wranglerOAuthToken();
  if (accountId && token) {
    const r = await getPagesProject(accountId, project, token);
    if (r.ok && r.data) {
      const production = r.data.canonical_deployment;
      return production
        ? { kind: 'deployed', url: production.url, createdOn: production.created_on }
        : { kind: 'empty' };
    }
    if (r.status === 404) return { kind: 'missing' };
  }

  const list = runCommand(
    `wrangler pages deployment list --project-name=${shellEscape(project)} --environment=production --json`,
  );
  if (list.ok) {
    try {
      const rows = JSON.parse(list.stdout.slice(list.stdout.indexOf('['))) as {
        Deployment?: string;
      }[];
      const first = rows[0];
      return first ? { kind: 'deployed', url: first.Deployment } : { kind: 'empty' };
    } catch {
      // Unreadable output; report unknown below.
    }
  }
  return {
    kind: 'unknown',
    detail: summarizeOutputLine(list),
  };
}

function describeDeployment(state: { url?: string; createdOn?: string }): string {
  const parts = [
    state.url ? pc.cyan(state.url) : '',
    state.createdOn ? `(${state.createdOn})` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

export async function runDeployPhase(
  projectRoot: string,
  doctorMode: boolean,
  options: DeployOptions = {},
): Promise<PhaseResult> {
  const followUpItems: FollowUp[] = [];
  let projectName = process.env.CLOUDFLARE_PAGES_PROJECT?.trim() || DEFAULT_PAGES_PROJECT;
  let productionBranch = process.env.CLOUDFLARE_PAGES_BRANCH?.trim() || DEFAULT_PRODUCTION_BRANCH;

  if (doctorMode) {
    // eslint-disable-next-line turbo/no-undeclared-env-vars -- the bootstrap's saved account choice, never read by a build.
    const savedAccount = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    if (!savedAccount) {
      log.info(
        pc.dim(
          'Doctor mode: no Cloudflare account saved yet, so the Pages project was not checked.',
        ),
      );
      return { success: true, followUpItems };
    }
    const state = await readPagesState(savedAccount, projectName);
    if (state.kind === 'deployed') {
      log.success(`Pages project ${pc.cyan(projectName)} is live ${describeDeployment(state)}`);
    } else if (state.kind === 'unknown') {
      log.warn(`Could not check Pages project ${projectName}: ${state.detail}`);
    } else {
      log.warn(
        state.kind === 'missing'
          ? `Pages project ${projectName} does not exist yet.`
          : `Pages project ${projectName} has no production deployment yet.`,
      );
      followUpItems.push({
        kind: 'remote',
        message:
          'Create the Pages project and its first deployment: `pnpm bootstrap --phase deploy`',
      });
    }
    return { success: followUpItems.length === 0, followUpItems };
  }

  const whoami = runCommand('wrangler whoami');
  if (!whoami.ok) {
    log.warn('wrangler is not authenticated.');
    followUpItems.push({
      kind: 'auth',
      message: 'Authenticate Cloudflare Wrangler: `wrangler login`',
    });
    return { success: false, followUpItems };
  }

  const accountResolution = await ensureCloudflareAccount(projectRoot);
  if (!accountResolution.ok) {
    log.error('Could not resolve a Cloudflare account.');
    if (accountResolution.raw) {
      logSubline(pc.dim(accountResolution.raw.split('\n').slice(0, 3).join('\n')));
    }
    followUpItems.push({ kind: 'auth', message: 'Re-authenticate: `wrangler login`' });
    return { success: false, followUpItems };
  }
  if (accountResolution.accountId) {
    log.info(pc.dim(`Cloudflare account: ${accountResolution.accountId}`));
  }
  const accountId = accountResolution.accountId;

  // Check first. A finished setup has a project and a production deployment,
  // and a re-run leaves both alone unless --redeploy asks for a new push.
  let state = await readPagesState(accountId, projectName);

  if (state.kind === 'missing') {
    note(
      `There is no Pages project named ${pc.cyan(projectName)} in this account yet.\nI'll create it and push ${pc.cyan('./dist')} as its first production deployment.`,
      'Cloudflare Pages',
    );
    const proceed = await promptConfirm(
      'deploy.proceed',
      'Create the project and deploy now?',
      true,
    );
    if (!proceed) {
      log.info(pc.dim('Skipping. Deploy deferred.'));
      followUpItems.push({
        kind: 'remote',
        message: 'Create the Cloudflare Pages project: `pnpm bootstrap --phase deploy`',
      });
      return { success: false, followUpItems };
    }

    const projectNameRaw = await rt().prompts.text({
      id: 'deploy.project',
      message: 'Cloudflare Pages project name (press Enter to keep the default)',
      placeholder: projectName,
      defaultValue: projectName,
      validate: validatePagesProjectName,
    });
    const branchRaw = await rt().prompts.text({
      id: 'deploy.branch',
      message: 'Production branch (press Enter to keep the default)',
      placeholder: productionBranch,
      defaultValue: productionBranch,
      validate: validateGitBranch,
    });
    const chosenProject = projectNameRaw.trim() || projectName;
    productionBranch = branchRaw.trim() || productionBranch;
    if (chosenProject !== projectName) {
      projectName = chosenProject;
      state = await readPagesState(accountId, projectName);
    }
    persistProject(projectRoot, projectName, productionBranch);
  }

  if (state.kind === 'deployed' && !options.redeploy) {
    log.success(
      `Pages project ${pc.cyan(projectName)} exists and production is deployed ${describeDeployment(state)}`,
    );
    log.info(
      pc.dim(
        'Nothing to do. New code reaches production through the Deploy production workflow on every push to main. To push this checkout on purpose, run `pnpm bootstrap --phase deploy --redeploy`.',
      ),
    );
    return { success: true, followUpItems };
  }

  if (state.kind === 'unknown') {
    log.warn(`Couldn't check whether ${projectName} already has a production deployment.`);
    if (state.detail) logSubline(pc.dim(state.detail));
    const anyway = await promptConfirm(
      'deploy.unknown-state',
      'Create the project if it is missing and push ./dist to production anyway?',
      false,
    );
    if (!anyway) {
      followUpItems.push({
        kind: 'auth',
        message:
          'Sign in again with `wrangler login`, then re-run `pnpm bootstrap --phase deploy` so it can check the Pages project.',
      });
      return { success: false, followUpItems };
    }
  }

  if (state.kind === 'empty') {
    log.info(`Pages project ${pc.cyan(projectName)} exists but has no production deployment yet.`);
    const deployNow = await promptConfirm(
      'deploy.first-deploy',
      'Push ./dist as the first production deployment now?',
      true,
    );
    if (!deployNow) {
      followUpItems.push({
        kind: 'remote',
        message: 'Push the first production deployment: `pnpm bootstrap --phase deploy`',
      });
      return { success: false, followUpItems };
    }
  }

  const created = state.kind === 'missing' || state.kind === 'unknown';
  if (created && !createProject(projectName, productionBranch, followUpItems)) {
    return { success: false, followUpItems };
  }

  const deployed = await deployDist(
    { projectRoot, projectName, productionBranch, build: options.redeploy === true },
    followUpItems,
  );
  if (!deployed) return { success: false, followUpItems };

  log.info(
    pc.dim(
      'Server-side secrets are not part of a deploy. `pnpm bootstrap --phase secrets` checks them and stores any that are missing.',
    ),
  );

  if (state.kind === 'missing') {
    const dashboardUrl = accountId
      ? `https://dash.cloudflare.com/${accountId}/pages/view/${projectName}`
      : 'https://dash.cloudflare.com/';
    followUpItems.push({
      kind: 'remote',
      message: `From now on, every push to main deploys through the "Deploy production" GitHub Actions workflow. It needs the CLOUDFLARE_API_TOKEN secret and CLOUDFLARE_ACCOUNT_ID variable listed in docs/reference/deployment-pipeline.md. Do not also connect the project to Git at ${dashboardUrl}, or each push would deploy twice.`,
    });
  }

  return { success: true, followUpItems };
}

// ── helpers ─────────────────────────────────────────────────────────────────

// Saves the names so the domain phase and later runs reuse them. A no-op when
// .env.local already holds these values.
function persistProject(projectRoot: string, projectName: string, productionBranch: string): void {
  mergeEnvFile(
    path.join(projectRoot, '.env.local'),
    new Map([
      ['CLOUDFLARE_PAGES_PROJECT', projectName],
      ['CLOUDFLARE_PAGES_BRANCH', productionBranch],
    ]),
  );
}

/**
 * Create the project. When the check above could not tell whether it exists,
 * Cloudflare's "name taken" error code (read from wrangler's stderr, since
 * wrangler has no JSON error output for this command) means it already does.
 */
function createProject(
  projectName: string,
  productionBranch: string,
  followUpItems: FollowUp[],
): boolean {
  const createSpinner = spinner();
  createSpinner.start(`Creating Pages project ${projectName}...`);
  const createResult = runCommand(
    `wrangler pages project create ${shellEscape(projectName)} --production-branch=${shellEscape(productionBranch)}`,
  );
  if (createResult.ok) {
    createSpinner.stop(`Created Pages project ${pc.cyan(projectName)}.`);
    return true;
  }
  const raw = (createResult.stderr || createResult.stdout).trim();
  if (raw.includes(`code: ${CF_ERROR.PAGES_PROJECT_NAME_TAKEN}`)) {
    createSpinner.stop(`Pages project ${pc.cyan(projectName)} already exists — using it.`);
    return true;
  }
  createSpinner.stop('Could not create the Pages project');
  if (raw) log.error(raw.split('\n').slice(0, 4).join('\n'));
  followUpItems.push({
    kind: 'remote',
    message: `Resolve the wrangler error above, then re-run \`pnpm bootstrap --phase deploy\`.`,
  });
  return false;
}

interface DeployTarget {
  projectRoot: string;
  projectName: string;
  productionBranch: string;
  /** Build even when ./dist exists. A redeploy does, so it never pushes a stale build. */
  build: boolean;
}

async function deployDist(
  { projectRoot, projectName, productionBranch, build }: DeployTarget,
  followUpItems: FollowUp[],
): Promise<boolean> {
  const distDir = path.join(projectRoot, 'dist');
  if (build || !existsSync(distDir)) {
    log.info(`Running ${pc.cyan('pnpm build')} before deploying.`);
    const buildResult = runCommand('pnpm build', { cwd: projectRoot });
    if (!buildResult.ok) {
      log.error('pnpm build failed; cannot deploy.');
      log.error(summarizeOutputLine(buildResult));
      followUpItems.push({
        kind: 'local',
        message: 'Fix build errors and re-run `pnpm bootstrap --phase deploy`.',
      });
      return false;
    }
  }

  // taskLog keeps wrangler's output inside the TUI: collapses on success,
  // retains on failure. Inheriting stdio would paint over active spinners.
  const deployLog = taskLog({
    title: `Deploying ${pc.cyan('./dist')} to ${pc.cyan(projectName)}`,
    limit: 6,
    retainLog: false,
  });
  let liveUrl: string | undefined;
  const deployResult = await runStreamingCommand(
    `wrangler pages deploy ./dist --project-name=${shellEscape(projectName)} --branch=${shellEscape(productionBranch)} --commit-dirty=true`,
    {
      cwd: projectRoot,
      onLine: (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const url = matchPagesDeployUrl(trimmed);
        if (url) liveUrl = url;
        deployLog.message(trimmed);
      },
    },
  );

  if (!deployResult.ok) {
    deployLog.error('Deploy failed.', { showLog: true });
    followUpItems.push({
      kind: 'remote',
      message: `Re-run \`pnpm bootstrap --phase deploy\` once the error above is fixed. It checks first, so it will not create the project twice.`,
    });
    return false;
  }

  deployLog.success(
    liveUrl ? `Deployed to ${pc.cyan(liveUrl)}` : `Deployed to ${pc.cyan(projectName)}.`,
  );
  return true;
}

/** Pick the live `https://<hash>.<project>.pages.dev` URL out of wrangler's output. */
function matchPagesDeployUrl(line: string): string | undefined {
  const m = line.match(/https:\/\/[a-z0-9]+\.[a-z0-9-]+\.pages\.dev\b/i);
  return m ? m[0] : undefined;
}
