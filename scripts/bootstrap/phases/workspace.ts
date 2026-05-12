import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { log, spinner } from '@clack/prompts';
import pc from 'picocolors';
import { runCommand, summarizeOutputLine } from '../lib/shell.js';
import type { FollowUp, PhaseResult } from '../lib/types.js';

// Playwright's browser cache lives at OS-specific defaults:
// linux → ~/.cache/ms-playwright, macOS → ~/Library/Caches/ms-playwright.
// A directory entry that starts with `chromium` means the Chromium for
// the current Playwright version is already on disk; we skip the
// ~150 MB download on subsequent bootstraps when we find one.
function playwrightChromiumPresent(): boolean {
  const candidates = [
    path.join(homedir(), '.cache', 'ms-playwright'),
    path.join(homedir(), 'Library', 'Caches', 'ms-playwright'),
  ];
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    try {
      if (readdirSync(dir).some((entry) => entry.startsWith('chromium'))) return true;
    } catch {
      // Fall through to the next candidate.
    }
  }
  return false;
}

export async function runWorkspacePhase(
  projectRoot: string,
  doctorMode: boolean,
): Promise<PhaseResult> {
  const followUpItems: FollowUp[] = [];

  if (doctorMode) {
    // Doctor mode: verify the dev pipeline is wired without rebuilding
    // anything. Checks the Playwright browser cache and runs the two
    // fast budget audits against the existing dist/ (if present).
    if (playwrightChromiumPresent()) {
      log.success('Playwright Chromium: present in the local Playwright cache');
    } else {
      log.warn('Playwright Chromium: missing');
      followUpItems.push({
        kind: 'local',
        message: 'Install the audit browser: `pnpm test:install`',
      });
    }

    if (existsSync(path.join(projectRoot, 'dist'))) {
      for (const script of ['scripts/audit/bundle-size.ts', 'scripts/audit/asset-budget.ts']) {
        const result = runCommand(`pnpm exec tsx ${script}`, { cwd: projectRoot });
        const name = path.basename(script, '.ts');
        if (result.ok) {
          log.success(`${name}: within budget`);
        } else {
          log.warn(`${name}: budget breach`);
          followUpItems.push({
            kind: 'local',
            message: `\`${name}\` reports a breach — see \`pnpm exec tsx ${script}\` for details.`,
          });
        }
      }
    } else {
      log.info(pc.dim('dist/ not present; skipping bundle-size + asset-budget checks.'));
    }
    return { success: followUpItems.length === 0, followUpItems };
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

  // Playwright browsers — needed for the a11y, perf-memory, and
  // visual-regression specs. Skip the download if the cache already
  // has a chromium-* folder (cheap stat; the actual download is heavy).
  if (!playwrightChromiumPresent()) {
    const pwSpinner = spinner();
    pwSpinner.start('pnpm test:install (Playwright Chromium ~150 MB)');
    const pwResult = runCommand('pnpm test:install', { cwd: projectRoot });
    if (!pwResult.ok) {
      pwSpinner.stop('Playwright install failed');
      log.warn(summarizeOutputLine(pwResult));
      followUpItems.push({
        kind: 'local',
        message:
          'Audit specs need Chromium: run `pnpm test:install` once internet conditions allow.',
      });
    } else {
      pwSpinner.stop('Playwright Chromium installed.');
    }
  } else {
    log.success('Playwright Chromium already cached — skipping download.');
  }

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

  // Fast budget audits against the fresh dist. Bundle + image budgets
  // run in milliseconds, so the smoke is worth the runtime; lighthouse
  // and the playwright specs are left to CI and `pnpm check:baseline`.
  for (const script of ['scripts/audit/bundle-size.ts', 'scripts/audit/asset-budget.ts']) {
    const auditResult = runCommand(`pnpm exec tsx ${script}`, { cwd: projectRoot });
    const name = path.basename(script, '.ts');
    if (auditResult.ok) {
      log.success(`${name}: within budget`);
    } else {
      log.warn(`${name}: budget breach`);
      log.message(pc.dim(summarizeOutputLine(auditResult)));
      followUpItems.push({
        kind: 'local',
        message: `Review the ${name} report and either trim the asset or raise the budget in perf-budgets.json.`,
      });
    }
  }

  log.info(pc.dim('`pnpm dev`, `pnpm build`, and `pnpm check:baseline` are ready.'));
  return { success: followUpItems.length === 0, followUpItems };
}
