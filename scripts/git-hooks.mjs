#!/usr/bin/env node
// Turns on this repository's Git hooks and says plainly when they cannot run.
//
// `pnpm install` runs this through the root `prepare` script, and Claude Code
// runs it at session start (.claude/settings.json). The session-start path
// matters because `prepare` only runs after a successful install: a failed
// install (for example a GitHub Packages 401) used to leave a checkout with
// no hooks and no message saying so.
//
// It reuses the shared CLI's installer from the vendored standard, which needs
// no installed dependencies, so it works on a checkout where `pnpm install`
// has never succeeded.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { installGitHooks } from '../.lvbt/web-platform/packages/cli/src/lib/git-hooks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Claude Code adds a session-start hook's standard output to the agent's context.
const stream = process.argv.includes('--session-start') ? process.stdout : process.stderr;

function warn(lines) {
  stream.write(`\n${lines.map((line) => `  git hooks: ${line}`).join('\n')}\n\n`);
}

const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
  cwd: root,
  encoding: 'utf8',
});
// A source archive or container build has no Git checkout to protect.
if (inside.status !== 0 || inside.stdout.trim() !== 'true') process.exit(0);

try {
  installGitHooks(root);
} catch (error) {
  // An overriding hooksPath (a global hook manager, for example) means none of
  // the repository's checks run. Say so on every install instead of hiding it.
  warn([
    'NOT ACTIVE. Commits and pushes here skip the repository checks.',
    error instanceof Error ? error.message : String(error),
  ]);
  process.exit(0);
}

// The hooks call the shared CLI and `pnpm check` from installed dependencies.
// Without them, every commit and push fails, which is correct but confusing
// unless someone says why.
const cli = path.join(root, 'node_modules', '@lasvegasfortransit', 'cli', 'hooks');
if (!existsSync(cli))
  warn([
    'active, but dependencies are not installed, so commits and pushes will fail.',
    'Run `pnpm install`. If it fails with a GitHub Packages 401, give your personal pnpm',
    'config a package-read token, then install again:',
    '  gh auth refresh -s read:packages',
    '  pnpm config set //npm.pkg.github.com/:_authToken "$(gh auth token)"',
    'See docs/tutorials/first-time-setup.md#clone-and-bootstrap.',
  ]);
