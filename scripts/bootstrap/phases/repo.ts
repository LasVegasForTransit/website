import path from 'node:path';
import { existsSync } from 'node:fs';
import { log, note, spinner, text } from '@clack/prompts';
import pc from 'picocolors';
import type { FollowUp, PhaseResult } from '../lib/types.js';
import {
  runCommand,
  runInteractiveCommand,
  shellEscape,
  summarizeOutputLine,
} from '../lib/shell.js';
import { promptOrExit, promptConfirm, logSubline } from '../lib/ui.js';
import { inferRepoDefaults } from '../lib/repo-defaults.js';
import { validateOwnerRepo } from '../lib/validators.js';

/**
 * Result of probing a GitHub repository.
 *
 * We deliberately do not try to classify *why* a probe failed by reading the
 * stderr text — error message strings are locale-dependent and unstable across
 * `gh` versions. We rely on:
 *   - exit codes (success vs failure)
 *   - JSON parse success (structured payload)
 * and surface raw stderr verbatim to the user when something goes wrong.
 */
type RepoProbe =
  | { kind: 'accessible'; url: string; sshUrl: string; nameWithOwner: string }
  | { kind: 'inaccessible'; raw: string };

export async function runRepoPhase(projectRoot: string, doctorMode: boolean): Promise<PhaseResult> {
  const followUpItems: FollowUp[] = [];
  const defaults = inferRepoDefaults(projectRoot);

  const hasLocalGit = existsSync(path.join(projectRoot, '.git'));
  const localOriginUrl = readLocalOrigin(projectRoot, hasLocalGit);
  if (localOriginUrl) {
    log.success(`origin already set: ${pc.cyan(localOriginUrl)}`);
    return { success: true, followUpItems };
  }

  if (doctorMode) {
    if (!hasLocalGit) log.warn('git: no local repository');
    log.warn('git origin: not set');
    followUpItems.push({
      kind: 'remote',
      message: 'Run `pnpm bootstrap --phase repo` to publish to GitHub and wire `origin`.',
    });
    return { success: false, followUpItems };
  }

  note(
    `Wires this checkout to a GitHub repo (default ${pc.cyan(defaults.fullName)}, public, branch ${pc.cyan('main')}) and pushes over SSH.\nIf the repo already exists, ${pc.cyan('origin')} is connected and the push proceeds.`,
    'GitHub',
  );

  const proceed = await promptConfirm('Connect or create the GitHub repo now?', true);
  if (!proceed) {
    log.info(pc.dim('Skipping. Repo step deferred.'));
    followUpItems.push({
      kind: 'remote',
      message: 'Publish to GitHub: `pnpm bootstrap --phase repo`',
    });
    return { success: true, followUpItems };
  }

  // Initialize local git if missing.
  if (!hasLocalGit) {
    const s = spinner();
    s.start('git init -b main');
    const initResult = runCommand('git init -b main', { cwd: projectRoot });
    if (!initResult.ok) {
      s.stop('git init failed');
      log.error(summarizeOutputLine(initResult));
      followUpItems.push({
        kind: 'local',
        message: 'Run `git init -b main` manually, then re-run `pnpm bootstrap --phase repo`.',
      });
      return { success: false, followUpItems };
    }
    s.stop('Local git repo initialized.');
  }

  // Verify gh is authenticated. If not, defer to the auth phase.
  const ghAuthCheck = runCommand('gh auth status');
  if (!ghAuthCheck.ok) {
    log.warn('gh is not authenticated.');
    followUpItems.push({
      kind: 'auth',
      message: 'Authenticate GitHub CLI: `gh auth login`',
    });
    return { success: false, followUpItems };
  }

  const commitGuard = await ensureInitialCommit(projectRoot);
  if (!commitGuard.ok) {
    if (commitGuard.followUp) followUpItems.push(commitGuard.followUp);
    return { success: false, followUpItems };
  }

  // Loop on name selection so the user can recover from a chosen-name conflict.
  let attempts = 0;
  let fullName = defaults.fullName;
  while (attempts < 5) {
    attempts += 1;

    const fullNameRaw = await promptOrExit(
      text({
        message: 'GitHub repo (owner/name)',
        placeholder: defaults.fullName,
        defaultValue: fullName,
        validate: validateOwnerRepo,
      }),
    );
    fullName =
      typeof fullNameRaw === 'string' && fullNameRaw.trim()
        ? fullNameRaw.trim()
        : defaults.fullName;

    const probe = spinner();
    probe.start(`Checking github.com/${fullName} ...`);
    const status = probeRepo(fullName, projectRoot);
    if (status.kind === 'accessible') {
      probe.stop(`Repo ${pc.cyan(fullName)} exists`);
      log.info(`${pc.bold('Found existing repo:')} ${pc.cyan(status.url)}`);
      const connect = await promptConfirm('Wire this repo as `origin` (SSH) and push?', true);
      if (!connect) {
        const tryDifferent = await promptConfirm('Pick a different name?', true);
        if (tryDifferent) continue;
        followUpItems.push({
          kind: 'remote',
          message: `Manually wire your remote: \`git remote add origin ${status.sshUrl} && git push -u origin main\``,
        });
        return { success: true, followUpItems };
      }

      // Default to SSH. If the user's SSH key isn't on GitHub, the push will
      // fail and we'll surface the raw stderr — they can fix and re-run.
      const wired = wireExistingRemote(projectRoot, status.sshUrl);
      if (!wired.ok) {
        log.error(wired.details ?? 'Failed to connect existing remote.');
        followUpItems.push({
          kind: 'remote',
          message: `Connect manually: \`git remote add origin ${status.sshUrl} && git push -u origin main\``,
        });
        return { success: false, followUpItems };
      }
      log.success(`Connected ${pc.cyan(fullName)} via SSH.`);
      printRepoUrl(fullName, projectRoot);
      return { success: true, followUpItems };
    }

    // Inaccessible. We don't know whether that's "doesn't exist," "no permission,"
    // or "network down." Show the raw error and let the user decide whether to
    // try to create it.
    probe.stop(`Repo ${pc.cyan(fullName)} not accessible`);
    if (status.raw.trim()) {
      logSubline(pc.dim(status.raw.split('\n').slice(0, 3).join('\n')));
    }

    const createIt = await promptConfirm(
      `Try to create ${fullName}? (If the repo actually exists but you can't see it, this will fail with a clear error.)`,
      true,
    );
    if (!createIt) {
      const tryDifferent = await promptConfirm('Pick a different name?', true);
      if (tryDifferent) continue;
      log.info(pc.dim('Skipping. Repo creation deferred.'));
      followUpItems.push({
        kind: 'remote',
        message: 'Publish to GitHub: `pnpm bootstrap --phase repo`',
      });
      return { success: true, followUpItems };
    }

    const isPublic = await promptConfirm('Make the repo public?', true);
    const visibility = isPublic ? '--public' : '--private';

    const s = spinner();
    s.start(`Creating ${fullName} on GitHub...`);
    // Create the empty repo first; we wire the SSH remote ourselves so the
    // protocol doesn't depend on the user's `gh config get git_protocol`.
    const createResult = runCommand(
      `gh repo create ${shellEscape(fullName)} ${visibility} --description ${shellEscape('Las Vegans for Better Transit — official website')}`,
      { cwd: projectRoot },
    );

    if (createResult.ok) {
      s.stop(`Created ${pc.cyan(fullName)}`);

      const sshUrl = `git@github.com:${fullName}.git`;
      const wired = wireExistingRemote(projectRoot, sshUrl);
      if (!wired.ok) {
        log.error(wired.details ?? 'Failed to wire SSH origin and push.');
        followUpItems.push({
          kind: 'remote',
          message: `Wire manually: \`git remote add origin ${sshUrl} && git push -u origin main\``,
        });
        return { success: false, followUpItems };
      }
      log.success(`Wired ${pc.cyan(fullName)} as origin (SSH) and pushed.`);
      printRepoUrl(fullName, projectRoot);
      return { success: true, followUpItems };
    }

    s.stop('gh repo create failed');
    // Show raw stderr verbatim — gh's error messages are clear ("Name already exists",
    // "rate limited", "permission denied") so the user can read them.
    const rawErr = (createResult.stderr || createResult.stdout).trim();
    if (rawErr) log.error(rawErr.split('\n').slice(0, 6).join('\n'));

    const tryDifferent = await promptConfirm('Try again with a different name?', true);
    if (tryDifferent) continue;

    const tryInteractive = await promptConfirm(
      'Drop into the interactive `gh repo create` flow?',
      false,
    );
    if (tryInteractive) {
      const ok = runInteractiveCommand('gh repo create', { cwd: projectRoot });
      if (ok) {
        printRepoUrl(fullName, projectRoot);
        return { success: true, followUpItems };
      }
    }

    followUpItems.push({
      kind: 'remote',
      message: `Resolve the GitHub error above (\`gh repo create ${fullName}\`), then re-run \`pnpm bootstrap --phase repo\`.`,
    });
    return { success: false, followUpItems };
  }

  followUpItems.push({
    kind: 'remote',
    message:
      'Too many name attempts. Re-run `pnpm bootstrap --phase repo` when you know the repo name.',
  });
  return { success: false, followUpItems };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function readLocalOrigin(projectRoot: string, hasLocalGit: boolean): string | null {
  if (!hasLocalGit) return null;
  const r = runCommand('git remote get-url origin', { cwd: projectRoot });
  return r.ok && r.stdout ? r.stdout : null;
}

function probeRepo(fullName: string, projectRoot: string): RepoProbe {
  // Use --json to force a structured response. Exit code is the source of truth:
  // 0 = visible to the authenticated user; non-zero = not visible (could be
  // not-found, no-permission, or network — we don't try to guess).
  const result = runCommand(
    `gh repo view ${shellEscape(fullName)} --json url,sshUrl,nameWithOwner`,
    { cwd: projectRoot },
  );
  if (!result.ok) {
    return { kind: 'inaccessible', raw: result.stderr || result.stdout };
  }
  try {
    const parsed = JSON.parse(result.stdout) as {
      url: string;
      sshUrl: string;
      nameWithOwner: string;
    };
    return {
      kind: 'accessible',
      url: parsed.url,
      sshUrl: parsed.sshUrl,
      nameWithOwner: parsed.nameWithOwner,
    };
  } catch (err) {
    return {
      kind: 'inaccessible',
      raw: `gh returned exit 0 but malformed JSON: ${(err as Error).message}`,
    };
  }
}

interface CommitGuardResult {
  ok: boolean;
  followUp?: FollowUp;
}

async function ensureInitialCommit(projectRoot: string): Promise<CommitGuardResult> {
  // `git rev-parse --verify HEAD` exits 0 iff there's at least one commit.
  const head = runCommand('git rev-parse --verify HEAD', { cwd: projectRoot });
  if (head.ok) return { ok: true };

  log.warn('No commits yet. Pushing requires at least one commit.');
  const makeIt = await promptConfirm(
    'Make an initial commit now (`git add . && git commit -m "Initial commit"`)?',
    true,
  );
  if (!makeIt) {
    return {
      ok: false,
      followUp: {
        kind: 'local',
        message:
          'Make your initial commit (`git add . && git commit -m "Initial commit"`), then re-run `pnpm bootstrap --phase repo`.',
      },
    };
  }

  const add = runCommand('git add .', { cwd: projectRoot });
  if (!add.ok) {
    log.error(summarizeOutputLine(add));
    return {
      ok: false,
      followUp: {
        kind: 'local',
        message: '`git add .` failed — resolve and re-run `pnpm bootstrap --phase repo`.',
      },
    };
  }

  const commit = runCommand(`git commit -m ${shellEscape('Initial commit')}`, { cwd: projectRoot });
  if (!commit.ok) {
    // Surface stderr verbatim — could be hooks, identity, etc.
    const raw = (commit.stderr || commit.stdout).trim();
    if (raw) log.error(raw.split('\n').slice(0, 4).join('\n'));
    return {
      ok: false,
      followUp: {
        kind: 'local',
        message: 'Resolve the `git commit` error above and re-run `pnpm bootstrap --phase repo`.',
      },
    };
  }
  log.success('Initial commit created.');
  return { ok: true };
}

interface WireResult {
  ok: boolean;
  details?: string;
}

function wireExistingRemote(projectRoot: string, url: string): WireResult {
  const existing = runCommand('git remote get-url origin', { cwd: projectRoot });
  if (existing.ok) {
    if (existing.stdout !== url) {
      const setUrl = runCommand(`git remote set-url origin ${shellEscape(url)}`, {
        cwd: projectRoot,
      });
      if (!setUrl.ok) return { ok: false, details: setUrl.stderr || setUrl.stdout };
    }
  } else {
    const add = runCommand(`git remote add origin ${shellEscape(url)}`, { cwd: projectRoot });
    if (!add.ok) return { ok: false, details: add.stderr || add.stdout };
  }

  const branch = readCurrentBranch(projectRoot) ?? 'main';
  const push = runCommand(`git push -u origin ${shellEscape(branch)}`, { cwd: projectRoot });
  if (!push.ok) {
    return { ok: false, details: (push.stderr || push.stdout).trim() };
  }
  return { ok: true };
}

function readCurrentBranch(projectRoot: string): string | null {
  const r = runCommand('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot });
  return r.ok && r.stdout ? r.stdout : null;
}

function printRepoUrl(fullName: string, projectRoot: string): void {
  const urlResult = runCommand(`gh repo view ${shellEscape(fullName)} --json url -q .url`, {
    cwd: projectRoot,
  });
  if (urlResult.ok && urlResult.stdout) {
    log.info(`${pc.bold('Repo:')} ${pc.cyan(urlResult.stdout)}`);
  }
}
