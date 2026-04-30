import { log, spinner } from '@clack/prompts';
import pc from 'picocolors';
import { runCommand, summarizeOutputLine } from '../lib/shell.js';
import type { FollowUp, PhaseResult } from '../lib/types.js';

export async function runWorkspacePhase(
  projectRoot: string,
  doctorMode: boolean,
): Promise<PhaseResult> {
  const followUpItems: FollowUp[] = [];

  if (doctorMode) {
    log.info(
      pc.dim('Workspace phase is a no-op in doctor mode (it would install deps and rebuild).'),
    );
    return { success: true, followUpItems: [] };
  }

  const installSpinner = spinner();
  installSpinner.start('pnpm install --frozen-lockfile');
  let installResult = runCommand('pnpm install --frozen-lockfile', { cwd: projectRoot });
  if (!installResult.ok) {
    installSpinner.message('Lockfile drift — falling back to `pnpm install`');
    installResult = runCommand('pnpm install', { cwd: projectRoot });
  }
  if (!installResult.ok) {
    installSpinner.stop('pnpm install failed');
    log.error(summarizeOutputLine(installResult));
    followUpItems.push({
      kind: 'local',
      message: 'Resolve `pnpm install` errors and re-run `pnpm bootstrap --phase workspace`.',
    });
    return { success: false, followUpItems };
  }
  installSpinner.stop('Dependencies installed.');

  const buildSpinner = spinner();
  buildSpinner.start('pnpm build (smoke test)');
  const buildResult = runCommand('pnpm build', { cwd: projectRoot });
  if (!buildResult.ok) {
    buildSpinner.stop('Build failed');
    log.error(summarizeOutputLine(buildResult));
    followUpItems.push({
      kind: 'local',
      message: 'Fix build errors (`pnpm build`) before deploying.',
    });
    return { success: false, followUpItems };
  }
  buildSpinner.stop('Build succeeded.');

  log.info(pc.dim('`pnpm dev` and `pnpm build` will both work now.'));
  return { success: true, followUpItems };
}
