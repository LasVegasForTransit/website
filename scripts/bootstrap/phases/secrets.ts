import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { log, note, password } from '@clack/prompts';
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

function printReport(inventory: Inventory): void {
  const unreadable = (Object.keys(inventory) as SecretTarget[]).filter((t) => !inventory[t]);
  const lines: string[] = [];
  for (const secret of PLATFORM_SECRETS) {
    const missing = missingTargets(secret, inventory);
    const status =
      missing.length === 0
        ? pc.green('set everywhere')
        : pc.yellow(`missing on ${missing.map((t) => TARGET_LABEL[t]).join(', ')}`);
    lines.push(`${secret.name}  ${status}`);
    if (missing.length > 0) lines.push(pc.dim(`  needed for: ${secret.neededFor}`));
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

// A generated value, a pasted value, or null when the person skips it.
async function obtainValue(secret: PlatformSecret): Promise<string | null> {
  if (secret.generate) {
    log.info(`${pc.bold(secret.name)}: generated a new random value.`);
    return `${randomUUID()}${randomUUID()}`.replaceAll('-', '');
  }
  note(`${secret.purpose}\n\n${pc.bold('Where to get it:')} ${secret.source ?? ''}`, secret.name);
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
  followUpItems: FollowUp[],
): Promise<void> {
  if (!secret.afterSet) return;
  if (!secret.generate) {
    followUpItems.push({ kind: 'remote', message: secret.afterSet });
    return;
  }
  const show = await promptConfirm(
    `${secret.afterSet} Show the generated value once so you can copy it?`,
    true,
  );
  if (show) note(value, `${secret.name} (copy it now; it is not stored locally)`);
}

export async function runSecretsPhase(
  projectRoot: string,
  doctorMode: boolean,
): Promise<PhaseResult> {
  const inventory = takeInventory(projectRoot);
  printReport(inventory);

  const followUpItems: FollowUp[] = PLATFORM_MANUAL_STEPS.map((message) => ({
    kind: 'remote',
    message,
  }));
  const pending = PLATFORM_SECRETS.filter((secret) => missingTargets(secret, inventory).length > 0);

  if (doctorMode || pending.length === 0) {
    return { success: pending.length === 0, followUpItems };
  }

  let skipped = 0;
  for (const secret of pending) {
    const targets = missingTargets(secret, inventory).filter((target) => inventory[target]);
    if (targets.length === 0) continue;

    const value = await obtainValue(secret);
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
    await finishAfterSet(secret, value, followUpItems);
  }

  return {
    success: skipped === 0,
    followUpItems,
    details: skipped > 0 ? `${skipped} secret(s) still missing` : undefined,
  };
}
