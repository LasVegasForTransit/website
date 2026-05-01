#!/usr/bin/env tsx
/**
 * LVBT Website Bootstrap CLI
 *
 * Usage:
 *   pnpm bootstrap                    Full interactive setup
 *   pnpm bootstrap --doctor           Read-only readiness check
 *   pnpm bootstrap --resume           Skip phases that already completed
 *   pnpm bootstrap --local-only       Skip phases that need GitHub/Cloudflare
 *   pnpm bootstrap --phase env        Run a single phase by id
 *
 * Phases (in order):
 *   install   — verify Node, pnpm, gh, wrangler; install missing
 *   auth      — ensure gh + wrangler are logged in
 *   workspace — pnpm install + pnpm build smoke
 *   env       — write .env.local; prompt for Beehiiv/donate/social URLs
 *   repo      — gh repo create + push (skipped if origin already set)
 *   deploy    — wrangler pages project create + first deploy
 *   domain    — verify lasvegasfortransit.org points at the Pages project
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { intro, log, note, outro } from '@clack/prompts';
import pc from 'picocolors';
import { detectOs } from './lib/os.js';
import { loadEnvLocal } from './lib/load-env.js';
import { mergeEnvFile } from './lib/env-file.js';
import type { FollowUp, FollowUpKind, PhaseId, PhaseResult } from './lib/types.js';
import { COMMAND_CAPABILITY_MAP } from './config/prerequisites.js';
import { loadReadiness, markPhase, saveReadiness } from './state.js';
import type { ReadinessState } from './state.js';
import { promptConfirm } from './lib/ui.js';
import { runInstallPhase } from './phases/install.js';
import { runAuthPhase } from './phases/auth.js';
import { runWorkspacePhase } from './phases/workspace.js';
import { runEnvPhase } from './phases/env.js';
import { runRepoPhase } from './phases/repo.js';
import { runDeployPhase } from './phases/deploy.js';
import { runDomainPhase } from './phases/domain.js';

const PHASE_ORDER: PhaseId[] = ['install', 'auth', 'workspace', 'env', 'repo', 'deploy', 'domain'];

const PHASE_INFO: Record<PhaseId, { title: string; what: string }> = {
  install: {
    title: 'System tools',
    what: "Making sure Node, pnpm, gh, and wrangler are around. Anything missing, I'll offer to install.",
  },
  auth: {
    title: 'CLI authentication',
    what: 'Confirming gh and wrangler are logged in. You can skip either if today is local-only.',
  },
  workspace: {
    title: 'Workspace + build smoke',
    what: "Installing deps and running a build to make sure nothing's broken before we touch anything remote.",
  },
  env: {
    title: 'Site environment variables',
    what: 'Filling in your live newsletter, donate, and social URLs in .env.local. Placeholders are fine to start.',
  },
  repo: {
    title: 'GitHub repository',
    what: "Pushing the code to GitHub — creating the repo if it doesn't exist, or wiring up an existing one.",
  },
  deploy: {
    title: 'Cloudflare Pages',
    what: "Provisioning the Pages project and pushing your first build. After this, you'll wire auto-deploys on push.",
  },
  domain: {
    title: 'Custom domain',
    what: 'Checking whether your domain points at the Pages project, and handing you the link to attach it if not.',
  },
};

interface CliArgs {
  doctorMode: boolean;
  resume: boolean;
  localOnly: boolean;
  phase: PhaseId | null;
}

function parseArgs(argv: string[]): CliArgs {
  const phaseFlagIdx = argv.indexOf('--phase');
  const phase =
    phaseFlagIdx !== -1 ? ((argv[phaseFlagIdx + 1] as PhaseId | undefined) ?? null) : null;
  if (phase && !PHASE_ORDER.includes(phase)) {
    console.error(`Unknown phase "${phase}". Valid: ${PHASE_ORDER.join(', ')}`);
    process.exit(2);
  }
  return {
    doctorMode: argv.includes('--doctor'),
    resume: argv.includes('--resume'),
    localOnly: argv.includes('--local-only'),
    phase,
  };
}

function shouldSkipPhase(phaseId: PhaseId, state: ReadinessState, resume: boolean): boolean {
  if (!resume) return false;
  return state.phases[phaseId]?.status === 'complete';
}

async function confirmResumeSkip(phaseName: string): Promise<boolean> {
  return !(await promptConfirm(`${phaseName} was already completed. Re-run it?`, false));
}

function recomputeCommandReadiness(state: ReadinessState): void {
  for (const [group, requiredCaps] of Object.entries(COMMAND_CAPABILITY_MAP)) {
    const allReady = requiredCaps.every((capId) => state.capabilities[capId]?.status === 'ready');
    state.commandReadiness[group as keyof typeof state.commandReadiness] = allReady
      ? 'ready'
      : 'blocked';
  }
}

function printSummary(state: ReadinessState): void {
  const lines: string[] = [];
  lines.push(pc.bold('Command readiness:'));
  for (const [group, status] of Object.entries(state.commandReadiness)) {
    const icon = status === 'ready' ? pc.green('ready') : pc.yellow('blocked');
    lines.push(`  ${group}: ${icon}`);
  }
  lines.push('');
  lines.push(pc.bold('Phases:'));
  for (const phase of PHASE_ORDER) {
    const phaseState = state.phases[phase];
    if (!phaseState) {
      lines.push(`  ${phase}: ${pc.gray('not run')}`);
      continue;
    }
    const icon =
      phaseState.status === 'complete'
        ? pc.green('complete')
        : phaseState.status === 'failed'
          ? pc.red('failed')
          : pc.yellow(phaseState.status);
    lines.push(`  ${phase}: ${icon}`);
  }
  note(lines.join('\n'), 'Bootstrap status');
}

async function runPhaseById(
  phaseId: PhaseId,
  projectRoot: string,
  state: ReadinessState,
  args: CliArgs,
): Promise<PhaseResult> {
  const os = detectOs();
  if (!os) {
    log.error('Unsupported OS. LVBT bootstrap requires macOS or Linux.');
    process.exit(1);
  }

  switch (phaseId) {
    case 'install':
      return runInstallPhase(state, os, args.doctorMode, args.localOnly);
    case 'auth':
      return runAuthPhase(state, args.doctorMode, args.localOnly);
    case 'workspace':
      return runWorkspacePhase(projectRoot, args.doctorMode);
    case 'env':
      return runEnvPhase(projectRoot, args.doctorMode, state);
    case 'repo':
      return runRepoPhase(projectRoot, args.doctorMode);
    case 'deploy':
      return runDeployPhase(projectRoot, args.doctorMode);
    case 'domain':
      return runDomainPhase(projectRoot, args.doctorMode);
  }
}

function isLocalPhase(phaseId: PhaseId): boolean {
  return phaseId === 'install' || phaseId === 'workspace' || phaseId === 'env';
}

function printOverview(args: CliArgs, runningPhases: PhaseId[]): void {
  const lines: string[] = [];
  if (args.doctorMode) {
    lines.push("Just looking — I won't change anything.");
  } else {
    lines.push(
      'Walking the LVBT site from this checkout to a live deploy. Safe to re-run; --resume skips finished phases.',
    );
  }
  lines.push('');
  for (let i = 0; i < runningPhases.length; i++) {
    const id = runningPhases[i]!;
    const info = PHASE_INFO[id];
    lines.push(`  ${pc.dim(`${i + 1}.`)} ${pc.bold(id)} — ${info.title}`);
  }
  lines.push('');
  lines.push(pc.dim('Ctrl+C any time. Progress is saved between phases.'));
  note(lines.join('\n'), args.doctorMode ? 'Preflight' : 'Bootstrap');
}

function printNextSteps(state: ReadinessState, args: CliArgs): void {
  if (args.doctorMode) return;
  const lines: string[] = [];
  const partial = PHASE_ORDER.filter((p) => state.phases[p]?.status === 'partial');
  if (partial.length > 0) {
    lines.push('To pick up where you left off:');
    for (const id of partial) {
      lines.push(`  pnpm bootstrap --phase ${id}`);
    }
    lines.push('');
  }
  lines.push("Day-to-day, you'll mostly want:");
  lines.push('  pnpm dev          start the dev server');
  lines.push('  pnpm build        smoke-build before pushing');
  lines.push('  pnpm preflight    re-check readiness');
  lines.push('');
  lines.push('To update content, edit the MDX under src/content/ and push to main.');
  note(lines.join('\n'), 'Next steps');
}

const FOLLOWUP_TITLES: Record<FollowUpKind, string> = {
  local: 'On your machine',
  auth: 'Sign in somewhere',
  remote: 'In a browser',
};

function printFollowUps(items: FollowUp[]): void {
  if (items.length === 0) return;
  const order: FollowUpKind[] = ['auth', 'local', 'remote'];
  for (const kind of order) {
    const subset = items.filter((i) => i.kind === kind);
    if (subset.length === 0) continue;
    const lines = subset.map((i) => `• ${i.message}`);
    note(lines.join('\n'), FOLLOWUP_TITLES[kind]);
  }
}

/**
 * CF API tokens are printable ASCII alphanumeric with `-`/`_`. If a paste
 * captured a stray Unicode char, the token is unusable and persists in
 * `.env.local` — every subsequent wrangler/Pages call fails with a generic
 * ByteString error. Detect and clear before we hand control to phases.
 */
const CF_TOKEN_CHARSET = /^[A-Za-z0-9_-]+$/;

function sanitizeCloudflareApiToken(projectRoot: string): void {
  const value = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!value) return;
  if (CF_TOKEN_CHARSET.test(value)) return;
  log.warn('CLOUDFLARE_API_TOKEN in env is malformed — clearing it.');
  delete process.env.CLOUDFLARE_API_TOKEN;
  mergeEnvFile(`${projectRoot}/.env.local`, new Map([['CLOUDFLARE_API_TOKEN', '']]));
}

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, '../..');
  const args = parseArgs(process.argv.slice(2));

  // Hydrate process.env from .env.local so persisted choices (e.g.
  // CLOUDFLARE_ACCOUNT_ID) survive across runs.
  loadEnvLocal(projectRoot);

  // Wrangler 4 auto-loads `.env.local` from disk, which is independent from
  // our subprocessEnv() scrub. If a previous paste captured stray Unicode
  // (a `❯` prompt arrow, a smart quote), that bad token sits in .env.local
  // and crashes every wrangler call with "Cannot convert argument to a
  // ByteString". Clear it from both places before anything else runs.
  sanitizeCloudflareApiToken(projectRoot);

  intro(
    args.doctorMode
      ? pc.bgCyan(pc.black(' LVBT Doctor '))
      : pc.bgBlue(pc.white(' LVBT Bootstrap ')),
  );

  const state = loadReadiness(projectRoot);
  const allFollowUp: FollowUp[] = [];

  // Single-phase mode
  if (args.phase) {
    const info = PHASE_INFO[args.phase];
    note(info.what, `Phase: ${args.phase} — ${info.title}`);
    const result = await runPhaseById(args.phase, projectRoot, state, args);
    markPhase(state, args.phase, result.success ? 'complete' : 'partial');
    saveReadiness(projectRoot, state);
    allFollowUp.push(...result.followUpItems);
    recomputeCommandReadiness(state);
    saveReadiness(projectRoot, state);
    printFollowUps(allFollowUp);
    outro(result.success ? pc.green('Phase complete.') : pc.yellow('Phase had issues.'));
    return;
  }

  // Determine which phases will actually run, then preview them.
  const runningPhases: PhaseId[] = PHASE_ORDER.filter((p) => !(args.localOnly && !isLocalPhase(p)));
  printOverview(args, runningPhases);

  // Full or local-only flow
  for (let i = 0; i < runningPhases.length; i++) {
    const phaseId = runningPhases[i]!;
    const info = PHASE_INFO[phaseId];

    const completed = shouldSkipPhase(phaseId, state, args.resume);
    if (completed) {
      const skip = await confirmResumeSkip(phaseId);
      if (skip) {
        log.info(`Skipping ${phaseId} (already complete).`);
        continue;
      }
    }

    note(info.what, `Phase ${i + 1} of ${runningPhases.length} · ${info.title}`);

    const result = await runPhaseById(phaseId, projectRoot, state, args);
    markPhase(state, phaseId, result.success ? 'complete' : 'partial');
    saveReadiness(projectRoot, state);
    allFollowUp.push(...result.followUpItems);
  }

  recomputeCommandReadiness(state);
  saveReadiness(projectRoot, state);
  printSummary(state);

  printFollowUps(allFollowUp);
  printNextSteps(state, args);

  outro(args.doctorMode ? 'Doctor check complete.' : pc.green('Bootstrap complete.'));
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
