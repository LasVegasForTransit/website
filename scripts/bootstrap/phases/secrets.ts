import { randomUUID } from 'node:crypto';
import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import type { FollowUp, PhaseResult } from '../lib/types.js';
import { runCommand } from '../lib/shell.js';
import { promptConfirm } from '../lib/ui.js';
import { rt } from '../lib/runtime.js';
import {
  PLATFORM_MANUAL_STEPS,
  PLATFORM_SECRETS,
  skipNoteFor,
  type GuidedStep,
  type PlatformSecret,
  type SecretTarget,
} from '../config/platform-secrets.js';
import { isConfirmed, markConfirmed, type ReadinessState } from '../state.js';

const WORKER_NAME = 'lvbt-website';
const PAGES_PROJECT = 'lvbt-website';
const GITHUB_ENVIRONMENT = 'worker-candidate';

const TARGET_LABEL: Record<SecretTarget, string> = {
  worker: `Worker ${WORKER_NAME}`,
  pages: `Pages ${PAGES_PROJECT}`,
  'github:worker-candidate': `GitHub environment ${GITHUB_ENVIRONMENT}`,
};

type Inventory = Record<SecretTarget, Set<string> | null>;

// The secrets bootstrap asks for, and the ones it only lists because no
// feature reads them yet.
const ASKED = PLATFORM_SECRETS.filter((secret) => secret.listOnly !== true);
const LISTED_ONLY = PLATFORM_SECRETS.filter((secret) => secret.listOnly === true);

export function canGenerateSecret(secret: PlatformSecret, inventory: Inventory): boolean {
  return (
    secret.generate === true &&
    secret.targets.every((target) => inventory[target]?.has(secret.name) === false)
  );
}

function workerSecretNames(projectRoot: string): Set<string> | null {
  const result = runCommand(
    `pnpm -s exec wrangler secret list --name ${WORKER_NAME} --format json`,
    {
      cwd: projectRoot,
    },
  );
  if (!result.ok) return null;
  try {
    const parsed = JSON.parse(result.stdout.slice(result.stdout.indexOf('['))) as {
      name: string;
    }[];
    return new Set(parsed.map((entry) => entry.name));
  } catch {
    return null;
  }
}

function pagesSecretNames(projectRoot: string): Set<string> | null {
  const result = runCommand(
    `pnpm -s exec wrangler pages secret list --project-name ${PAGES_PROJECT}`,
    { cwd: projectRoot },
  );
  if (!result.ok) return null;
  const names = [...result.stdout.matchAll(/^\s+-\s+([A-Z0-9_]+):/gm)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
  return new Set(names);
}

function githubSecretNames(projectRoot: string): Set<string> | null {
  const result = runCommand(`gh secret list --env ${GITHUB_ENVIRONMENT} --json name`, {
    cwd: projectRoot,
  });
  if (!result.ok) return null;
  try {
    return new Set((JSON.parse(result.stdout) as { name: string }[]).map((entry) => entry.name));
  } catch {
    return null;
  }
}

function takeInventory(projectRoot: string): Inventory {
  return {
    worker: workerSecretNames(projectRoot),
    pages: pagesSecretNames(projectRoot),
    'github:worker-candidate': githubSecretNames(projectRoot),
  };
}

function missingTargets(secret: PlatformSecret, inventory: Inventory): SecretTarget[] {
  return secret.targets.filter((target) => !inventory[target]?.has(secret.name));
}

function setCommand(target: SecretTarget, name: string): string {
  switch (target) {
    case 'worker':
      // A new version carries the secret without deploying it, so this is safe
      // while production is still served by Pages.
      return `pnpm -s exec wrangler versions secret put ${name} --name ${WORKER_NAME} --message "Set ${name}"`;
    case 'pages':
      return `pnpm -s exec wrangler pages secret put ${name} --project-name ${PAGES_PROJECT}`;
    case 'github:worker-candidate':
      return `gh secret set ${name} --env ${GITHUB_ENVIRONMENT}`;
  }
}

// Values travel on stdin only, so they never appear in a process list or a log.
function writeSecret(
  projectRoot: string,
  target: SecretTarget,
  name: string,
  value: string,
): boolean {
  const result = rt().runWithInput(setCommand(target, name), value, { cwd: projectRoot });
  if (!result.ok) {
    log.error(`Could not set ${name} on ${TARGET_LABEL[target]}: ${result.stderr}`);
    return false;
  }
  return true;
}

// When a missing secret is needed: `now` when a live feature on the current
// production host (Pages) lacks it, `switch` when only the Worker that takes
// over production lacks it, `later` when only an unbuilt feature uses it.
type Stage = 'now' | 'switch' | 'later';

const STAGE_HEADING: Record<Stage, string> = {
  now: 'Needed now: a live feature is waiting for these',
  switch: 'Needed before the Worker takes over production',
  later: 'Needed later: for features that are not built yet',
};

function stageOf(secret: PlatformSecret, inventory: Inventory): Stage {
  if (secret.use === 'future') return 'later';
  return missingTargets(secret, inventory).includes('pages') ? 'now' : 'switch';
}

function printReport(inventory: Inventory): void {
  const unreadable = (Object.keys(inventory) as SecretTarget[]).filter((t) => !inventory[t]);
  const lines: string[] = [];
  const pending = ASKED.filter((secret) => missingTargets(secret, inventory).length > 0);
  const done = ASKED.length - pending.length;
  lines.push(pc.green(`${done} of ${ASKED.length} set everywhere they are needed.`));
  for (const stage of ['now', 'switch', 'later'] as const) {
    const group = pending.filter((secret) => stageOf(secret, inventory) === stage);
    if (group.length === 0) continue;
    lines.push('', pc.bold(STAGE_HEADING[stage]));
    for (const secret of group) {
      lines.push(`  ${secret.name}  ${pc.dim(`(${secret.neededFor})`)}`);
    }
  }
  if (LISTED_ONLY.length > 0) {
    lines.push('', pc.bold('Not asked for: no feature uses these yet'));
    for (const secret of LISTED_ONLY) {
      lines.push(`  ${secret.name}  ${pc.dim(`(${secret.neededFor})`)}`);
    }
    lines.push(pc.dim('  Leave them empty. docs/reference/platform-secrets.md explains why.'));
  }
  if (unreadable.length > 0) {
    lines.push('');
    lines.push(
      pc.red(
        `Could not read: ${unreadable.map((t) => TARGET_LABEL[t]).join(', ')}. Check wrangler and gh sign-in.`,
      ),
    );
  }
  note(lines.join('\n'), 'Platform secrets');
}

function numbered(steps: readonly string[]): string[] {
  return steps.map((step, index) => `${index + 1}. ${step}`);
}

// What the value is for, when skipping is fine, where bootstrap stores it,
// and the click-by-click steps to get it.
function instructions(secret: PlatformSecret): string {
  const lines = [`${pc.bold('What it is for:')} ${secret.purpose}`];
  const skip = skipNoteFor(secret);
  if (skip) lines.push(`${pc.bold('Fine to skip?')} ${skip}`);
  lines.push(
    `${pc.bold('Stored on:')} ${secret.targets.map((t) => TARGET_LABEL[t]).join(', ')}. You paste it once; bootstrap stores it everywhere.`,
  );
  if (secret.url) lines.push('', `${pc.bold('Open:')} ${pc.cyan(secret.url)}`);
  if (secret.steps?.length) lines.push('', ...numbered(secret.steps));
  return lines.join('\n');
}

/**
 * A setup step bootstrap cannot check for itself. Shown until the person
 * confirms it is done; the "yes" is remembered in the bootstrap state file,
 * so a later run never asks again.
 */
async function confirmPrerequisite(
  step: GuidedStep,
  state: ReadinessState | undefined,
): Promise<boolean> {
  if (state && isConfirmed(state, step.id)) return true;
  const lines = [...numbered(step.steps)];
  if (step.url) lines.unshift(`${pc.bold('Open:')} ${pc.cyan(step.url)}`, '');
  note(lines.join('\n'), `First: ${step.title}`);
  if (
    step.url &&
    (await promptConfirm(`${step.id}.open`, 'Open that page in your browser?', true))
  ) {
    rt().openUrl(step.url);
  }
  const done = await promptConfirm(step.id, step.question, false);
  if (done && state) markConfirmed(state, step.id);
  return done;
}

type ValueMode = 'missing' | 'rotate';

const REUSE_WARNING =
  'This secret is already set elsewhere or a target could not be checked. Paste the same existing value; generating a new one here would break the integration. Leave the prompt empty if you cannot retrieve it.';

const ROTATE_WARNING =
  'You asked to replace this value. Paste the NEW value. It replaces the current one everywhere it is stored, so the old one stops working.';

// A generated value, a pasted value, or null when the person skips it.
async function obtainValue(
  secret: PlatformSecret,
  generate: boolean,
  mode: ValueMode = 'missing',
): Promise<string | null> {
  if (generate) {
    log.info(`${pc.bold(secret.name)}: generated a new random value.`);
    return `${randomUUID()}${randomUUID()}`.replaceAll('-', '');
  }
  const warning = mode === 'rotate' ? ROTATE_WARNING : secret.generate ? REUSE_WARNING : '';
  note([warning, instructions(secret)].filter(Boolean).join('\n\n'), secret.name);
  if (
    secret.url &&
    (await promptConfirm(`${secret.name}.open`, 'Open that page in your browser?', true))
  ) {
    rt().openUrl(secret.url);
  }
  const entered = await rt().prompts.password({
    id: secret.name,
    message: `Paste ${secret.name} (leave empty to skip for now)`,
    validate: (raw) => {
      const trimmed = (raw ?? '').trim();
      return trimmed ? secret.validate?.(trimmed) : undefined;
    },
  });
  const value = entered.trim();
  return value || null;
}

/** Writes `value` to each target; returns how many writes failed. */
function writeEverywhere(
  projectRoot: string,
  secret: PlatformSecret,
  targets: readonly SecretTarget[],
  value: string,
): number {
  let failed = 0;
  for (const target of targets) {
    if (writeSecret(projectRoot, target, secret.name, value)) {
      log.success(`${secret.name} → ${TARGET_LABEL[target]}`);
    } else {
      failed += 1;
    }
  }
  return failed;
}

/**
 * Replace a secret that is already set, on every target, because the person
 * asked for it with --rotate. Every target must be readable first, so a
 * shared value is never replaced in some places and left in others.
 */
async function rotateSecret(
  projectRoot: string,
  secret: PlatformSecret,
  inventory: Inventory,
  followUpItems: FollowUp[],
): Promise<boolean> {
  const unreadable = secret.targets.filter((target) => !inventory[target]);
  if (unreadable.length > 0) {
    log.error(
      `Not rotating ${secret.name}: could not read ${unreadable.map((t) => TARGET_LABEL[t]).join(', ')}.`,
    );
    followUpItems.push({
      kind: 'auth',
      message: `Check wrangler and gh sign-in, then re-run: pnpm bootstrap --phase secrets --rotate ${secret.name}`,
    });
    return false;
  }
  const generated = secret.generate === true;
  const value = await obtainValue(secret, generated, 'rotate');
  if (!value) {
    log.info(pc.dim(`${secret.name} left unchanged.`));
    return false;
  }
  if (writeEverywhere(projectRoot, secret, secret.targets, value) > 0) {
    followUpItems.push({
      kind: 'remote',
      message: `${secret.name} was not replaced everywhere. Re-run: pnpm bootstrap --phase secrets --rotate ${secret.name}`,
    });
    return false;
  }
  await finishAfterSet(secret, value, generated, followUpItems);
  return true;
}

async function finishAfterSet(
  secret: PlatformSecret,
  value: string,
  generated: boolean,
  followUpItems: FollowUp[],
): Promise<void> {
  // A pasted value was copied from that other place, so it is already there.
  if (!secret.afterSet || !generated) return;
  const show = await promptConfirm(
    `${secret.name}.show-generated`,
    `${secret.afterSet} Show the generated value once so you can copy it?`,
    true,
  );
  if (show) {
    note(value, `${secret.name}: paste it there now, before you copy anything else`);
    log.info(pc.dim('It is not stored on this machine, and bootstrap will not show it again.'));
  } else {
    followUpItems.push({
      kind: 'remote',
      message: `${secret.afterSet} To get a value you can see, run: pnpm bootstrap --phase secrets --rotate ${secret.name}`,
    });
  }
}

// Asks how far to go, then returns the secrets to ask for, most urgent first.
async function chooseSecrets(
  missing: PlatformSecret[],
  inventory: Inventory,
  followUpItems: FollowUp[],
): Promise<PlatformSecret[]> {
  const stages = new Set(missing.map((secret) => stageOf(secret, inventory)));
  const scope = await rt().prompts.select<Stage>({
    id: 'secrets.scope',
    message: 'Which values do you want to set now?',
    initialValue: stages.has('now') ? 'now' : stages.has('switch') ? 'switch' : 'later',
    options: [
      { value: 'now', label: 'Only what live features need', hint: STAGE_HEADING.now },
      { value: 'switch', label: 'Those, plus what the Worker switch-over needs' },
      { value: 'later', label: 'Everything, including features not built yet' },
    ],
  });
  const order: Stage[] = ['now', 'switch', 'later'];
  const pending = missing
    .filter((secret) => order.indexOf(stageOf(secret, inventory)) <= order.indexOf(scope))
    .sort((a, b) => order.indexOf(stageOf(a, inventory)) - order.indexOf(stageOf(b, inventory)));
  const left = missing.length - pending.length;
  if (left > 0) {
    followUpItems.push({
      kind: 'remote',
      message: `${left} more secret(s) can wait. Set them later with: pnpm bootstrap --phase secrets`,
    });
  }
  return pending;
}

export interface SecretsOptions {
  /** Secret names to replace even though they are already set. */
  rotate?: readonly string[];
  /** Bootstrap state, where confirmed setup steps are remembered. */
  state?: ReadinessState;
}

// Targets that lack the secret and can be written to now.
function settableTargets(secret: PlatformSecret, inventory: Inventory): SecretTarget[] {
  return missingTargets(secret, inventory).filter((target) => inventory[target]);
}

export async function runSecretsPhase(
  projectRoot: string,
  doctorMode: boolean,
  options: SecretsOptions = {},
): Promise<PhaseResult> {
  const inventory = takeInventory(projectRoot);
  printReport(inventory);

  // The only manual step today is the read:packages scope; skip it once granted.
  const scopes = runCommand('gh auth status', { cwd: projectRoot });
  const hasPackages = `${scopes.stdout}${scopes.stderr}`.includes('read:packages');
  const followUpItems: FollowUp[] = PLATFORM_MANUAL_STEPS.filter(
    (step) => !(hasPackages && step.includes('read:packages')),
  ).map((message) => ({ kind: 'remote', message }));
  const missing = ASKED.filter((secret) => missingTargets(secret, inventory).length > 0);

  if (doctorMode) {
    return { success: missing.length === 0, followUpItems };
  }

  // Replacing a value that is already set happens only on request.
  let skipped = 0;
  const rotate = new Set(options.rotate ?? []);
  for (const secret of ASKED.filter((s) => rotate.has(s.name))) {
    if (!(await rotateSecret(projectRoot, secret, inventory, followUpItems))) skipped += 1;
  }

  // A secret missing only where the inventory could not be read can't be set
  // now; asking for it would store nothing. The report above names the cause.
  const remaining = missing.filter((secret) => !rotate.has(secret.name));
  const actionable = remaining.filter((secret) => settableTargets(secret, inventory).length > 0);
  const blocked = remaining.length - actionable.length;
  if (blocked > 0) {
    followUpItems.push({
      kind: 'auth',
      message: `${blocked} secret(s) could not be checked. Sign in again (pnpm exec wrangler login, gh auth login), then re-run: pnpm bootstrap --phase secrets`,
    });
  }

  const pending =
    actionable.length > 0 ? await chooseSecrets(actionable, inventory, followUpItems) : [];
  for (const secret of pending) {
    if (secret.prerequisite && !(await confirmPrerequisite(secret.prerequisite, options.state))) {
      skipped += 1;
      followUpItems.push({
        kind: 'remote',
        message: `${secret.name} waits for "${secret.prerequisite.title}". Do that, then re-run: pnpm bootstrap --phase secrets`,
      });
      continue;
    }
    const targets = settableTargets(secret, inventory);
    const generated = canGenerateSecret(secret, inventory);
    const value = await obtainValue(secret, generated);
    if (!value) {
      skipped += 1;
      followUpItems.push({
        kind: 'remote',
        message: `${secret.name} is still missing (${secret.neededFor}). Re-run: pnpm bootstrap --phase secrets`,
      });
      continue;
    }
    if (writeEverywhere(projectRoot, secret, targets, value) > 0) {
      skipped += 1;
      followUpItems.push({
        kind: 'remote',
        message: `${secret.name} could not be stored everywhere. Re-run: pnpm bootstrap --phase secrets`,
      });
    }
    await finishAfterSet(secret, value, generated, followUpItems);
  }

  const incomplete = skipped + blocked;
  return {
    success: incomplete === 0,
    followUpItems,
    details: incomplete > 0 ? `${incomplete} secret(s) still missing` : undefined,
  };
}
