import path from 'node:path';
import { existsSync } from 'node:fs';
import { log, note, spinner, taskLog, text } from '@clack/prompts';
import pc from 'picocolors';
import type { FollowUp, PhaseResult } from '../lib/types.js';
import { runCommand, runStreamingCommand, shellEscape, summarizeOutputLine } from '../lib/shell.js';
import { promptOrExit, promptConfirm, logSubline } from '../lib/ui.js';
import { ensureCloudflareAccount } from '../lib/cloudflare.js';
import { mergeEnvFile } from '../lib/env-file.js';
import { validatePagesProjectName, validateGitBranch } from '../lib/validators.js';
import { DEFAULT_PAGES_PROJECT, DEFAULT_PRODUCTION_BRANCH } from '../lib/defaults.js';
import { CF_ERROR } from '../lib/cloudflare-api.js';

export async function runDeployPhase(
  projectRoot: string,
  doctorMode: boolean,
): Promise<PhaseResult> {
  const followUpItems: FollowUp[] = [];
  const distDir = path.join(projectRoot, 'dist');

  if (doctorMode) {
    log.info(pc.dim('Doctor mode: would provision Cloudflare Pages and push ./dist. Skipped.'));
    return { success: true, followUpItems: [] };
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

  let projectName = process.env.CLOUDFLARE_PAGES_PROJECT?.trim() || DEFAULT_PAGES_PROJECT;
  let productionBranch = process.env.CLOUDFLARE_PAGES_BRANCH?.trim() || DEFAULT_PRODUCTION_BRANCH;

  note(
    `Provisioning a Cloudflare Pages project and pushing ${pc.cyan('./dist')} as your first build.\nOnce that's done you'll wire auto-deploys-on-push from the dashboard.`,
    'Cloudflare Pages',
  );

  const proceed = await promptConfirm('Provision and deploy now?', true);
  if (!proceed) {
    log.info(pc.dim('Skipping. Deploy deferred.'));
    followUpItems.push({
      kind: 'remote',
      message: 'Provision Cloudflare Pages: `pnpm bootstrap --phase deploy`',
    });
    return { success: true, followUpItems };
  }

  const projectNameRaw = await promptOrExit(
    text({
      message: 'Cloudflare Pages project name',
      placeholder: projectName,
      defaultValue: projectName,
      validate: validatePagesProjectName,
    }),
  );
  if (typeof projectNameRaw === 'string' && projectNameRaw.trim()) {
    projectName = projectNameRaw.trim();
  }

  const branchRaw = await promptOrExit(
    text({
      message: 'Production branch',
      placeholder: productionBranch,
      defaultValue: productionBranch,
      validate: validateGitBranch,
    }),
  );
  if (typeof branchRaw === 'string' && branchRaw.trim()) {
    productionBranch = branchRaw.trim();
  }

  // Try to create. We don't probe first — wrangler's project list has missed
  // entries that creation rejected as duplicates, so probing was lying to us.
  // For "already exists" we look only for the numeric Cloudflare error code in
  // wrangler's stderr — wrangler doesn't expose API errors structurally yet,
  // but the code itself is a stable Cloudflare contract regardless of locale
  // or wrangler's prose around it.
  const createSpinner = spinner();
  createSpinner.start(`Ensuring Pages project ${projectName} exists...`);
  const createResult = runCommand(
    `wrangler pages project create ${shellEscape(projectName)} --production-branch=${shellEscape(productionBranch)}`,
  );
  if (createResult.ok) {
    createSpinner.stop(`Created Pages project ${pc.cyan(projectName)}.`);
  } else {
    const raw = (createResult.stderr || createResult.stdout).trim();
    const alreadyExists = raw.includes(`code: ${CF_ERROR.PAGES_PROJECT_NAME_TAKEN}`);
    if (alreadyExists) {
      createSpinner.stop(`Pages project ${pc.cyan(projectName)} already exists — using it.`);
    } else {
      createSpinner.stop('Could not create the Pages project');
      if (raw) log.error(raw.split('\n').slice(0, 4).join('\n'));
      followUpItems.push({
        kind: 'remote',
        message: `Resolve the wrangler error above, then re-run \`pnpm bootstrap --phase deploy\`.`,
      });
      return { success: false, followUpItems };
    }
  }

  // Build if dist/ is missing.
  if (!existsSync(distDir)) {
    log.info(`No ${pc.cyan('./dist')} found — running ${pc.cyan('pnpm build')} first.`);
    const buildResult = runCommand('pnpm build', { cwd: projectRoot });
    if (!buildResult.ok) {
      log.error('pnpm build failed; cannot deploy.');
      log.error(summarizeOutputLine(buildResult));
      followUpItems.push({
        kind: 'local',
        message: 'Fix build errors and re-run `pnpm bootstrap --phase deploy`.',
      });
      return { success: false, followUpItems };
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
      message: `Deploy manually: wrangler pages deploy ./dist --project-name=${projectName} --branch=${productionBranch}`,
    });
    return { success: false, followUpItems };
  }

  liveUrl = liveUrl ?? readLastDeploymentUrl(projectName);
  deployLog.success(
    liveUrl ? `Deployed to ${pc.cyan(liveUrl)}` : `Deployed to ${pc.cyan(projectName)}.`,
  );

  // Persist resolved values so domain phase + future runs reuse them.
  mergeEnvFile(
    path.join(projectRoot, '.env.local'),
    new Map([
      ['CLOUDFLARE_PAGES_PROJECT', projectName],
      ['CLOUDFLARE_PAGES_BRANCH', productionBranch],
    ]),
  );

  // Deep link to the dashboard's Git wiring page — wrangler doesn't expose this.
  const gitWiringUrl = accountId
    ? `https://dash.cloudflare.com/${accountId}/pages/view/${projectName}/settings/builds-deployments`
    : `https://dash.cloudflare.com/?to=/:account/pages/view/${projectName}/settings/builds-deployments`;
  followUpItems.push({
    kind: 'remote',
    message: `Wire auto-deploys (push-to-main): ${gitWiringUrl}`,
  });

  return { success: true, followUpItems };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function readLastDeploymentUrl(projectName: string): string | undefined {
  const r = runCommand(
    `wrangler pages deployment list --project-name=${shellEscape(projectName)} --json`,
  );
  if (!r.ok || !r.stdout.trim()) return undefined;
  try {
    const deployments = JSON.parse(r.stdout) as Array<{ url?: string }>;
    return deployments[0]?.url;
  } catch {
    return undefined;
  }
}

/** Pick the live `https://<hash>.<project>.pages.dev` URL out of wrangler's output. */
function matchPagesDeployUrl(line: string): string | undefined {
  const m = line.match(/https:\/\/[a-z0-9]+\.[a-z0-9-]+\.pages\.dev\b/i);
  return m ? m[0] : undefined;
}
