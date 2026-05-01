import { log, spinner } from '@clack/prompts';
import pc from 'picocolors';
import { CAPABILITY_SPECS, type CapabilityConfig } from '../config/prerequisites.js';
import type { FollowUp, PhaseResult, SupportedOs } from '../lib/types.js';
import { runCommand, summarizeOutputLine } from '../lib/shell.js';
import { isVersionGte } from '../lib/os.js';
import { promptConfirm, printToolTable, type ToolRow } from '../lib/ui.js';
import { markCapability, type ReadinessState } from '../state.js';

export async function runInstallPhase(
  state: ReadinessState,
  os: SupportedOs,
  doctorMode: boolean,
  localOnly: boolean,
): Promise<PhaseResult> {
  const followUpItems: FollowUp[] = [];
  let allReady = true;
  const rows: ToolRow[] = [];

  for (const cap of CAPABILITY_SPECS) {
    const result = checkCapability(cap);

    if (result.installed) {
      rows.push({ label: cap.label, status: 'ready', detail: result.version ?? '' });
      markCapability(state, cap.id, {
        status: 'ready',
        installStatus: 'ready',
        detectedVersion: result.version,
      });
      continue;
    }

    const isRequired = cap.requiredByDefault || cap.category === 'core';
    const skippedByLocalOnly = localOnly && cap.category !== 'core';

    if (skippedByLocalOnly) {
      rows.push({ label: cap.label, status: 'skipped', detail: 'not needed for local dev' });
      markCapability(state, cap.id, {
        status: 'skipped',
        installStatus: 'skipped',
        details: 'not needed for --local-only',
      });
      continue;
    }

    if (doctorMode) {
      rows.push({ label: cap.label, status: 'failed', detail: 'not installed' });
      markCapability(state, cap.id, {
        status: 'failed',
        installStatus: 'failed',
        details: 'not installed',
      });
      followUpItems.push({
        kind: 'local',
        message: `Install ${cap.label}: ${cap.installCommands[os].join(' && ')}`,
      });
      allReady = false;
      continue;
    }

    // Flush the running table so the prompt has clean context above it.
    if (rows.length > 0) {
      printToolTable('System tools', rows);
      rows.length = 0;
    }

    const shouldInstall = await promptConfirm(
      `${cap.label} is not installed${isRequired ? ' (required)' : ''}. Install it?`,
      isRequired,
    );

    if (!shouldInstall) {
      rows.push({ label: cap.label, status: 'deferred', detail: 'install deferred' });
      markCapability(state, cap.id, {
        status: 'deferred',
        installStatus: 'deferred',
      });
      followUpItems.push({
        kind: 'local',
        message: `Install ${cap.label}: ${cap.installCommands[os].join(' && ')}`,
      });
      if (isRequired) allReady = false;
      continue;
    }

    const s = spinner();
    s.start(`Installing ${cap.label}...`);

    let installOk = true;
    for (const cmd of cap.installCommands[os]) {
      const cmdResult = runCommand(cmd);
      if (!cmdResult.ok) {
        s.stop(`${cap.label} — install failed`);
        log.error(summarizeOutputLine(cmdResult));
        rows.push({ label: cap.label, status: 'failed', detail: 'install failed' });
        markCapability(state, cap.id, {
          status: 'failed',
          installStatus: 'failed',
          details: cmdResult.stderr,
        });
        followUpItems.push({
          kind: 'local',
          message: `Install ${cap.label} manually: ${cmd}`,
        });
        installOk = false;
        allReady = false;
        break;
      }
    }

    if (installOk) {
      const recheck = checkCapability(cap);
      if (recheck.installed) {
        s.stop(`${cap.label} installed`);
        rows.push({ label: cap.label, status: 'ready', detail: recheck.version ?? '' });
        markCapability(state, cap.id, {
          status: 'ready',
          installStatus: 'ready',
          detectedVersion: recheck.version,
        });
      } else {
        s.stop(`${cap.label} — installed but not detected on PATH`);
        rows.push({ label: cap.label, status: 'failed', detail: 'not on PATH' });
        markCapability(state, cap.id, {
          status: 'failed',
          installStatus: 'failed',
          details: 'installed but not on PATH',
        });
        if (cap.postInstallHint) {
          followUpItems.push({ kind: 'local', message: cap.postInstallHint });
        }
        allReady = false;
      }
    }
  }

  if (rows.length > 0) {
    printToolTable('System tools', rows);
  }

  const ready = rows.filter((r) => r.status === 'ready').length;
  const total = rows.length;
  if (allReady && total > 0) {
    log.success(pc.dim(`${ready} of ${total} tools ready.`));
  }

  return { success: allReady, followUpItems };
}

interface CapabilityCheck {
  installed: boolean;
  version?: string;
}

function firstLine(s: string): string {
  const newline = s.indexOf('\n');
  return (newline === -1 ? s : s.slice(0, newline)).trim();
}

function checkCapability(cap: CapabilityConfig): CapabilityCheck {
  const binaryResult = runCommand(cap.binaryCommand);
  if (!binaryResult.ok) {
    if (cap.pathCandidates) {
      for (const candidate of cap.pathCandidates) {
        const pathCheck = runCommand(`test -x "${candidate}"`);
        if (pathCheck.ok) {
          const dir = candidate.replace(/\/[^/]+$/, '');
          process.env.PATH = `${dir}:${process.env.PATH}`;
          return checkCapability({ ...cap, pathCandidates: undefined });
        }
      }
    }
    return { installed: false };
  }

  if (!cap.versionCommand) return { installed: true };

  const versionResult = runCommand(cap.versionCommand);
  if (!versionResult.ok) return { installed: true };

  let version = firstLine(versionResult.stdout);
  if (cap.versionPrefix) version = version.replace(cap.versionPrefix, '').trim();

  if (cap.minVersion && !isVersionGte(version, cap.minVersion)) {
    return { installed: false, version };
  }

  return { installed: true, version };
}
