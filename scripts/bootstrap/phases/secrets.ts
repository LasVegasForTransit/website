import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { log, note, password, select } from '@clack/prompts';
import pc from 'picocolors';
import type { FollowUp, PhaseResult } from '../lib/types.js';
import { runCommand } from '../lib/shell.js';
import { promptConfirm, promptOrExit } from '../lib/ui.js';
import {
  PLATFORM_MANUAL_STEPS,
  PLATFORM_SECRETS,
  type PlatformSecret,
  type SecretTarget,
} from '../config/platform-secrets.js';

const WORKER_NAME = 'lvbt-website';
const PAGES_PROJECT = 'lvbt-website';
const GITHUB_ENVIRONMENT = 'worker-candidate';

const TARGET_LABEL: Record<SecretTarget, string> = {
  worker: `Worker ${WORKER_NAME}`,
  pages: `Pages ${PAGES_PROJECT}`,
  'github:worker-candidate': `GitHub environment ${GITHUB_ENVIRONMENT}`,
};

type Inventory = Record<SecretTarget, Set<string> | null>;

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
  const result = spawnSync('/bin/sh', ['-c', setCommand(target, name)], {
    cwd: projectRoot,
    input: value,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    log.error(`Could not set ${name} on ${TARGET_LABEL[target]}: ${result.stderr.trim()}`);
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
  const pending = PLATFORM_SECRETS.filter((secret) => missingTargets(secret, inventory).length > 0);
  const done = PLATFORM_SECRETS.length - pending.length;
  lines.push(pc.green(`${done} of ${PLATFORM_SECRETS.length} set everywhere they are needed.`));
  for (const stage of ['now', 'switch', 'later'] as const) {
    const group = pending.filter((secret) => stageOf(secret, inventory) === stage);
    if (group.length === 0) continue;
    lines.push('', pc.bold(STAGE_HEADING[stage]));
    for (const secret of group) {
      lines.push(`  ${secret.name}  ${pc.dim(`(${secret.neededFor})`)}`);
    }
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

function openInBrowser(url: string): void {
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawnSync(opener, [url], { stdio: 'ignore' });
}

function instructions(secret: PlatformSecret): string {
  const lines = [secret.purpose];
  if (secret.url) lines.push('', `${pc.bold('Open:')} ${pc.cyan(secret.url)}`);
  if (secret.steps?.length) {
    lines.push('');
    secret.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  }
  return lines.join('\n');
}

// A generated value, a pasted value, or null when the person skips it.
async function obtainValue(secret: PlatformSecret, generate: boolean): Promise<string | null> {
  if (generate) {
    log.info(`${pc.bold(secret.name)}: generated a new random value.`);
    return `${randomUUID()}${randomUUID()}`.replaceAll('-', '');
  }
  const existingValueWarning = secret.generate
    ? 'This secret is already set elsewhere or a target could not be checked. Paste the same existing value; generating a new one here would break the integration. Leave the prompt empty if you cannot retrieve it.'
    : '';
  note([existingValueWarning, instructions(secret)].filter(Boolean).join('\n\n'), secret.name);
  if (secret.url && (await promptConfirm('Open that page in your browser?', true))) {
    openInBrowser(secret.url);
  }
  const entered = await promptOrExit(
    password({
      message: `Paste ${secret.name} (leave empty to skip for now)`,
      validate: (raw) => {
        const trimmed = (raw ?? '').trim();
        return trimmed ? secret.validate?.(trimmed) : undefined;
      },
    }),
  );
  const value = String(entered).trim();
  return value || null;
}

async function finishAfterSet(
  secret: PlatformSecret,
  value: string,
  generated: boolean,
  followUpItems: FollowUp[],
): Promise<void> {
  if (!secret.afterSet) return;
  if (!generated) {
    followUpItems.push({ kind: 'remote', message: secret.afterSet });
    return;
  }
  const show = await promptConfirm(
    `${secret.afterSet} Show the generated value once so you can copy it?`,
    true,
  );
  if (show) note(value, `${secret.name} (copy it now; it is not stored locally)`);
}

// Asks how far to go, then returns the secrets to ask for, most urgent first.
async function chooseSecrets(
  missing: PlatformSecret[],
  inventory: Inventory,
  followUpItems: FollowUp[],
): Promise<PlatformSecret[]> {
  const stages = new Set(missing.map((secret) => stageOf(secret, inventory)));
  const scope = (await promptOrExit(
    select<Stage>({
      message: 'Which values do you want to set now?',
      initialValue: stages.has('now') ? 'now' : stages.has('switch') ? 'switch' : 'later',
      options: [
        { value: 'now', label: 'Only what live features need', hint: STAGE_HEADING.now },
        { value: 'switch', label: 'Those, plus what the Worker switch-over needs' },
        { value: 'later', label: 'Everything, including features not built yet' },
      ],
    }),
  )) as Stage;
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

export async function runSecretsPhase(
  projectRoot: string,
  doctorMode: boolean,
): Promise<PhaseResult> {
  const inventory = takeInventory(projectRoot);
  printReport(inventory);

  // The only manual step today is the read:packages scope; skip it once granted.
  const scopes = runCommand('gh auth status', { cwd: projectRoot });
  const hasPackages = `${scopes.stdout}${scopes.stderr}`.includes('read:packages');
  const followUpItems: FollowUp[] = PLATFORM_MANUAL_STEPS.filter(
    (step) => !(hasPackages && step.includes('read:packages')),
  ).map((message) => ({ kind: 'remote', message }));
  const missing = PLATFORM_SECRETS.filter((secret) => missingTargets(secret, inventory).length > 0);

  if (doctorMode || missing.length === 0) {
    return { success: missing.length === 0, followUpItems };
  }

  const pending = await chooseSecrets(missing, inventory, followUpItems);

  let skipped = 0;
  for (const secret of pending) {
    const targets = missingTargets(secret, inventory).filter((target) => inventory[target]);
    if (targets.length === 0) continue;

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
    for (const target of targets) {
      if (writeSecret(projectRoot, target, secret.name, value)) {
        log.success(`${secret.name} → ${TARGET_LABEL[target]}`);
      }
    }
    await finishAfterSet(secret, value, generated, followUpItems);
  }

  return {
    success: skipped === 0,
    followUpItems,
    details: skipped > 0 ? `${skipped} secret(s) still missing` : undefined,
  };
}
