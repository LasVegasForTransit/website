import { log } from '@clack/prompts';
import { CAPABILITY_SPECS } from '../config/prerequisites.js';
import type { FollowUp, PhaseResult } from '../lib/types.js';
import { runCommand, runInteractiveCommand } from '../lib/shell.js';
import { promptConfirm, printToolTable, type ToolRow } from '../lib/ui.js';
import { markCapability, type ReadinessState } from '../state.js';

export async function runAuthPhase(
  state: ReadinessState,
  doctorMode: boolean,
  localOnly: boolean,
): Promise<PhaseResult> {
  const followUpItems: FollowUp[] = [];
  let allReady = true;
  const rows: ToolRow[] = [];

  const capsWithAuth = CAPABILITY_SPECS.filter((cap) => cap.auth);

  if (capsWithAuth.length === 0) {
    log.info('No CLI tools require authentication.');
    return { success: true, followUpItems: [] };
  }

  for (const cap of capsWithAuth) {
    const auth = cap.auth;
    if (!auth) continue;

    const capState = state.capabilities[cap.id];
    if (capState?.installStatus !== 'ready') {
      rows.push({ label: cap.label, status: 'skipped', detail: 'not installed' });
      continue;
    }

    if (localOnly && cap.category !== 'core') {
      const checkResult = runCommand(auth.checkCommand);
      if (checkResult.ok) {
        rows.push({ label: cap.label, status: 'ready', detail: 'authenticated' });
        markCapability(state, cap.id, { authStatus: 'ready' });
      } else {
        rows.push({ label: cap.label, status: 'skipped', detail: 'not needed for local dev' });
        markCapability(state, cap.id, { authStatus: 'skipped' });
      }
      continue;
    }

    const checkResult = runCommand(auth.checkCommand);
    if (checkResult.ok) {
      rows.push({ label: cap.label, status: 'ready', detail: 'authenticated' });
      markCapability(state, cap.id, { authStatus: 'ready' });
      continue;
    }

    if (doctorMode) {
      rows.push({ label: cap.label, status: 'failed', detail: 'not authenticated' });
      markCapability(state, cap.id, { authStatus: 'failed' });
      followUpItems.push({
        kind: 'auth',
        message: `Authenticate ${cap.label}: ${auth.loginCommand}`,
      });
      allReady = false;
      continue;
    }

    if (rows.length > 0) {
      printToolTable('Authentication', rows);
      rows.length = 0;
    }

    const shouldAuth = await promptConfirm(`${cap.label} is not authenticated. Log in now?`, true);

    if (!shouldAuth) {
      rows.push({ label: cap.label, status: 'deferred', detail: 'login deferred' });
      markCapability(state, cap.id, { authStatus: 'deferred' });
      followUpItems.push({
        kind: 'auth',
        message: `Authenticate ${cap.label}: ${auth.loginCommand}`,
      });
      continue;
    }

    const loginOk = runInteractiveCommand(auth.loginCommand);
    if (loginOk) {
      const recheck = runCommand(auth.checkCommand);
      if (recheck.ok) {
        rows.push({ label: cap.label, status: 'ready', detail: 'authenticated' });
        markCapability(state, cap.id, { authStatus: 'ready' });
      } else {
        rows.push({ label: cap.label, status: 'failed', detail: 'login did not stick' });
        markCapability(state, cap.id, {
          authStatus: 'failed',
          details: 'login succeeded but re-check failed',
        });
        allReady = false;
      }
    } else {
      rows.push({ label: cap.label, status: 'failed', detail: 'login failed' });
      markCapability(state, cap.id, { authStatus: 'failed' });
      followUpItems.push({
        kind: 'auth',
        message: `Authenticate ${cap.label}: ${auth.loginCommand}`,
      });
      allReady = false;
    }
  }

  if (rows.length > 0) {
    printToolTable('Authentication', rows);
  }

  return { success: allReady, followUpItems };
}
