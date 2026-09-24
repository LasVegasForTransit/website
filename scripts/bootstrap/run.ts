/**
 * The bootstrap flow: which phases run, in what order, and what gets
 * reported. `cold-start.ts` is the command-line entry that calls
 * `runBootstrap`; tests call it directly against a fake runtime.
 *
 * Every phase checks before it acts, so running the flow again on a finished
 * setup changes nothing, and running it after a partial run does only the
 * work that is left. Replacing something that already exists is always an
 * explicit option (--redeploy, --rotate), never a default.
 */

import { intro, log, note, outro } from '@clack/prompts';
import pc from 'picocolors';
import { detectOs } from './lib/os.js';
import { loadEnvLocal } from './lib/load-env.js';
import { clearCloudflareApiToken } from './lib/cloudflare.js';
import type { FollowUp, FollowUpKind, PhaseId, PhaseResult } from './lib/types.js';
import { COMMAND_CAPABILITY_MAP } from './config/prerequisites.js';
import { PLATFORM_SECRETS } from './config/platform-secrets.js';
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
import { runSecretsPhase } from './phases/secrets.js';

interface PhaseSpec {
  id: PhaseId;
  title: string;
  what: string;
  local: boolean; // runs in --local-only mode (no remote auth required)
}

// Single source of truth for the bootstrap phases. Order matters — phases
// run in this sequence and downstream lookups (PHASE_BY_ID, PHASE_ORDER,
// isLocalPhase) all derive from this array.
const PHASES: readonly PhaseSpec[] = [
  {
    id: 'install',
    title: 'System tools',
    what: "Making sure Node, pnpm, gh, and wrangler are around. Anything missing, I'll offer to install.",
    local: true,
  },
  {
    id: 'auth',
    title: 'CLI authentication',
    what: 'Confirming gh and wrangler are logged in. You can skip either if today is local-only.',
    local: false,
  },
  {
    id: 'workspace',
    title: 'Workspace + build smoke',
    what: "Installing deps and running a build to make sure nothing's broken before we touch anything remote.",
    local: true,
  },
  {
    id: 'env',
    title: 'Site environment variables',
    what: 'Filling in your live newsletter, donate, and social URLs in .env.local. Placeholders are fine to start.',
    local: true,
  },
  {
    id: 'repo',
    title: 'GitHub repository',
    what: "Pushing the code to GitHub — creating the repo if it doesn't exist, or wiring up an existing one.",
    local: false,
  },
  {
    id: 'deploy',
    title: 'Cloudflare Pages',
    what: 'Checking that the Pages project exists and has a production deployment. It creates the project and pushes the first build only when they are missing.',
    local: false,
  },
  {
    id: 'domain',
    title: 'Custom domain',
    what: 'Checking whether your domain points at the Pages project, and attaching and wiring only the hosts that are missing.',
    local: false,
  },
  {
    id: 'secrets',
    title: 'Platform secrets',
    what: 'Checking every server-side secret on the Worker, Pages and GitHub, asking for each missing one once, and storing it everywhere it is needed.',
    local: false,
  },
] as const;

const PHASE_BY_ID: Record<PhaseId, PhaseSpec> = Object.fromEntries(
  PHASES.map((p) => [p.id, p]),
) as Record<PhaseId, PhaseSpec>;
export const PHASE_ORDER: readonly PhaseId[] = PHASES.map((p) => p.id);

export interface CliArgs {
  doctorMode: boolean;
  resume: boolean;
  localOnly: boolean;
  phase: PhaseId | null;
  /** Push ./dist to Pages production even when a production deployment exists. */
  redeploy: boolean;
  /** Secret names to replace with a new value, even though they are already set. */
  rotate: readonly string[];
}

/** A command-line mistake; the entry point prints the message and exits 2. */
export class UsageError extends Error {}

/** Value of `--flag value` or `--flag=value`, or null when the flag is absent. */
function flagValue(argv: readonly string[], flag: string): string | null {
  const inline = argv.find((a) => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const idx = argv.indexOf(flag);
  if (idx === -1) return null;
  return argv[idx + 1] ?? '';
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const phaseRaw = flagValue(argv, '--phase');
  const phase = phaseRaw ? (phaseRaw as PhaseId) : null;
  if (phase && !PHASE_ORDER.includes(phase)) {
    throw new UsageError(`Unknown phase "${phase}". Valid: ${PHASE_ORDER.join(', ')}`);
  }

  const rotateRaw = flagValue(argv, '--rotate');
  const rotate = (rotateRaw ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (rotateRaw !== null && rotate.length === 0) {
    throw new UsageError(
      '--rotate needs one or more secret names, e.g. --rotate LVBT_SIGN_IN_SECRET',
    );
  }
  const known = new Set(PLATFORM_SECRETS.map((s) => s.name));
  const unknown = rotate.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new UsageError(
      `Unknown secret name(s) for --rotate: ${unknown.join(', ')}. The names are listed in docs/reference/platform-secrets.md.`,
    );
  }

  return {
    doctorMode: argv.includes('--doctor'),
    resume: argv.includes('--resume'),
    localOnly: argv.includes('--local-only'),
    phase,
    redeploy: argv.includes('--redeploy'),
    rotate,
  };
}

function shouldSkipPhase(phaseId: PhaseId, state: ReadinessState, resume: boolean): boolean {
  if (!resume) return false;
  return state.phases[phaseId]?.status === 'complete';
}

async function confirmResumeSkip(phaseName: string): Promise<boolean> {
  return !(await promptConfirm(
    'bootstrap.rerun-completed',
    `${phaseName} was already completed. Re-run it?`,
    false,
  ));
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
      return runDeployPhase(projectRoot, args.doctorMode, { redeploy: args.redeploy });
    case 'domain':
      return runDomainPhase(projectRoot, args.doctorMode);
    case 'secrets':
      return runSecretsPhase(projectRoot, args.doctorMode, { rotate: args.rotate, state });
  }
}

function isLocalPhase(phaseId: PhaseId): boolean {
  return PHASE_BY_ID[phaseId].local;
}

function printOverview(args: CliArgs, runningPhases: PhaseId[]): void {
  const lines: string[] = [];
  if (args.doctorMode) {
    lines.push("Just looking — I won't change anything.");
  } else {
    lines.push(
      'Walking the LVBT site from this checkout to a live deploy. Safe to re-run: every step checks first and only does what is missing.',
    );
  }
  lines.push('');
  for (const [i, id] of runningPhases.entries()) {
    const info = PHASE_BY_ID[id];
    lines.push(`  ${pc.dim(`${i + 1}.`)} ${pc.bold(id)} — ${info.title}`);
  }
  lines.push('');
  lines.push(pc.dim('Ctrl+C any time. Run it again later and it picks up where it stopped.'));
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
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- the bootstrap's own DNS token, never read by a build.
  const value = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!value) return;
  if (CF_TOKEN_CHARSET.test(value)) return;
  log.warn('CLOUDFLARE_API_TOKEN in env is malformed — clearing it.');
  clearCloudflareApiToken(projectRoot);
}

export interface BootstrapOutcome {
  state: ReadinessState;
  /** The result of every phase that ran, keyed by phase. */
  results: Partial<Record<PhaseId, PhaseResult>>;
  followUps: FollowUp[];
}

export async function runBootstrap(args: CliArgs, projectRoot: string): Promise<BootstrapOutcome> {
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
  const results: Partial<Record<PhaseId, PhaseResult>> = {};

  // Single-phase mode
  if (args.phase) {
    const info = PHASE_BY_ID[args.phase];
    note(info.what, `Phase: ${args.phase} — ${info.title}`);
    const result = await runPhaseById(args.phase, projectRoot, state, args);
    results[args.phase] = result;
    markPhase(state, args.phase, result.success ? 'complete' : 'partial');
    allFollowUp.push(...result.followUpItems);
    recomputeCommandReadiness(state);
    saveReadiness(projectRoot, state);
    printFollowUps(allFollowUp);
    outro(result.success ? pc.green('Phase complete.') : pc.yellow('Phase had issues.'));
    return { state, results, followUps: allFollowUp };
  }

  // Determine which phases will actually run, then preview them.
  const runningPhases: PhaseId[] = PHASE_ORDER.filter((p) => !(args.localOnly && !isLocalPhase(p)));
  printOverview(args, runningPhases);

  // Full or local-only flow
  for (const [i, phaseId] of runningPhases.entries()) {
    const info = PHASE_BY_ID[phaseId];

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
    results[phaseId] = result;
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
  return { state, results, followUps: allFollowUp };
}
