#!/usr/bin/env node
// Runs the full-history secret scan `pnpm check` requires.
//
// CI always runs the strict shared check: a missing scanner or shallow history
// fails the build there, so nothing reaches main unscanned.
//
// Outside CI the scan needs Gitleaks 8.30.1 or a running Docker daemon, plus
// full Git history. Sandboxed agent environments and some laptops have none of
// these and cannot get them. There the scan is skipped with a warning that says
// what is missing and that CI will run it, instead of failing every local
// `pnpm check` and pre-push run for a reason the contributor cannot fix.
// When a scanner is available locally, the strict check runs and a finding
// still fails.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { secretScannerFinding } from '../.lvbt/web-platform/packages/cli/src/lib/check/secrets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, '.lvbt/web-platform/packages/cli/src/cli.mjs');

function strict() {
  const run = spawnSync(process.execPath, [cli, 'check', 'secrets'], {
    cwd: root,
    stdio: 'inherit',
  });
  process.exit(run.status ?? 1);
}

if (process.env.CI) strict();

const missing = [];
const scanner = secretScannerFinding({ cwd: root });
if (scanner && !scanner.ok) missing.push(scanner.detail);
const shallow = spawnSync('git', ['rev-parse', '--is-shallow-repository'], {
  cwd: root,
  encoding: 'utf8',
});
if (shallow.status !== 0 || shallow.stdout.trim() !== 'false')
  missing.push('Git history is shallow or unavailable');

if (missing.length === 0) strict();

process.stderr.write(
  [
    '',
    '  WARNING  secret scan SKIPPED locally',
    ...missing.map((reason) => `           ${reason}.`),
    '           CI runs the full-history scan on every pull request and blocks on findings.',
    '           To scan here, install Gitleaks 8.30.1 or start Docker, and fetch full history',
    '           with git fetch --unshallow.',
    '',
    '',
  ].join('\n'),
);
