import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { pendingGoogleOperations } from '@lasvegasfortransit/platform-storage/google-pending';
import type { GoogleGroups } from './google-groups';
import { syncGoogleOperation, type GoogleSyncResult } from './google-sync';

export interface GoogleRunnerOptions {
  client: GoogleGroups;
  limit?: number;
  maxGroups?: number;
  now?: () => Date;
  rateLimit?: { current(): Promise<number | null> };
}
export interface GoogleRunCounts {
  selected: number;
  confirmed: number;
  retry: number;
  partial: number;
  busy: number;
  notReady: number;
  stale: number;
  paused: boolean;
}

function validOptions(limit: number, maxGroups: number, started: Date): boolean {
  return (
    Number.isInteger(limit) &&
    limit >= 1 &&
    limit <= 100 &&
    Number.isInteger(maxGroups) &&
    maxGroups >= 1 &&
    maxGroups <= 100 &&
    Number.isFinite(started.getTime())
  );
}

function addResult(counts: GoogleRunCounts, kind: GoogleSyncResult['kind']): void {
  switch (kind) {
    case 'confirmed':
      counts.confirmed += 1;
      break;
    case 'retry':
      counts.retry += 1;
      break;
    case 'partial':
      counts.partial += 1;
      break;
    case 'busy':
      counts.busy += 1;
      break;
    case 'not_ready':
      counts.notReady += 1;
      break;
    case 'stale':
      counts.stale += 1;
      break;
  }
}

async function isPaused(rateLimit: GoogleRunnerOptions['rateLimit']): Promise<boolean> {
  const remaining = await rateLimit?.current();
  return typeof remaining === 'number' && Number.isFinite(remaining) && remaining > 0;
}

/** Process due Workspace work only; each Google receipt remains provider-specific. */
export async function reconcileGooglePending(
  db: Db,
  options: GoogleRunnerOptions,
): Promise<GoogleRunCounts> {
  const limit = options.limit ?? 25;
  const maxGroups = options.maxGroups ?? 10;
  const now = options.now ?? (() => new Date());
  const started = now();
  if (!validOptions(limit, maxGroups, started))
    throw new Error('Invalid Google reconciliation configuration');

  const counts: GoogleRunCounts = {
    selected: 0,
    confirmed: 0,
    retry: 0,
    partial: 0,
    busy: 0,
    notReady: 0,
    stale: 0,
    paused: false,
  };
  if (await isPaused(options.rateLimit)) return { ...counts, paused: true };
  const operations = await pendingGoogleOperations(db, started, limit);
  for (const operationId of operations) {
    if (now().getTime() - started.getTime() >= 50_000) break;
    counts.selected += 1;
    const { kind } = await syncGoogleOperation(db, operationId, {
      client: options.client,
      maxGroups,
      now,
    });
    addResult(counts, kind);
    if (await isPaused(options.rateLimit)) {
      counts.paused = true;
      break;
    }
  }
  return counts;
}
