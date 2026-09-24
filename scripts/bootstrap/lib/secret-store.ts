// Where platform secrets are stored, how to read which names each place
// already has, and how to write a value to it. Values travel on standard
// input only, so they never appear in a process list or a log.

import { log } from '@clack/prompts';
import { runCommand } from './shell.js';
import { rt } from './runtime.js';
import type { PlatformSecret, SecretTarget } from '../config/platform-secrets.js';

const WORKER_NAME = 'lvbt-website';
const PAGES_PROJECT = 'lvbt-website';
const GITHUB_ENVIRONMENT = 'worker-candidate';

export const TARGET_LABEL: Record<SecretTarget, string> = {
  worker: `Worker ${WORKER_NAME}`,
  pages: `Pages ${PAGES_PROJECT}`,
  'github:worker-candidate': `GitHub environment ${GITHUB_ENVIRONMENT}`,
};

/** Secret names each target has, or null when it could not be read. */
export type Inventory = Record<SecretTarget, Set<string> | null>;

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

export function takeInventory(projectRoot: string): Inventory {
  return {
    worker: workerSecretNames(projectRoot),
    pages: pagesSecretNames(projectRoot),
    'github:worker-candidate': githubSecretNames(projectRoot),
  };
}

export function missingTargets(secret: PlatformSecret, inventory: Inventory): SecretTarget[] {
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

// Targets that lack the secret and can be written to now.
export function settableTargets(secret: PlatformSecret, inventory: Inventory): SecretTarget[] {
  return missingTargets(secret, inventory).filter((target) => inventory[target]);
}

/** Writes `value` to each target; returns how many writes failed. */
export function writeEverywhere(
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
