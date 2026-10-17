import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MetadataClient, object } from './preflight-api';
import { DeploymentFailure } from './release-failure';
import { saveReceipt, workerName, type DeploymentReceipt } from './release-receipt';
import type { DeploymentOptions } from './release-deploy';

export interface ScheduleReceipt {
  previous: string[];
  desired: string[];
  state: 'pending' | 'attempted' | 'confirmed';
}
export function boundedSchedules(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1 || value.some((cron) => cron !== '* * * * *'))
    throw new DeploymentFailure('jobs.schedule');
  return value as string[];
}
export async function readJobsSchedule(client: MetadataClient, name: string): Promise<string[]> {
  const rows = object(
    await client.get(`/workers/scripts/${encodeURIComponent(name)}/schedules`),
  ).schedules;
  if (!Array.isArray(rows)) throw new DeploymentFailure('jobs.schedule');
  return boundedSchedules(rows.map((row: unknown) => object(row).cron));
}
export function sameSchedule(a: string[], b: string[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function parseSchedule(value: unknown): ScheduleReceipt {
  const row = object(value);
  if (
    Object.keys(row).sort().join() !== 'desired,previous,state' ||
    !['pending', 'attempted', 'confirmed'].includes(String(row.state))
  )
    throw new DeploymentFailure('receipt');
  return {
    previous: boundedSchedules(row.previous),
    desired: boundedSchedules(row.desired),
    state: row.state as ScheduleReceipt['state'],
  };
}
export async function productionReleaseAllowed(
  options: Pick<DeploymentOptions, 'environment' | 'root' | 'assertSource'>,
) {
  await options.assertSource?.();
  if (options.environment !== 'production') return;
  const tooling = object(
    JSON.parse(await readFile(join(options.root, '.lvbt/tooling.json'), 'utf8')),
  );
  if (object(tooling.release).previewOnly !== false) throw new DeploymentFailure('configuration');
}
export async function captureSchedule(
  copy: string,
  options: DeploymentOptions,
): Promise<ScheduleReceipt> {
  const config = object(
    JSON.parse(await readFile(join(copy, 'jobs', `wrangler.${options.environment}.json`), 'utf8')),
  );
  const desired = boundedSchedules(object(config.triggers).crons);
  if (
    ((options.stage === 'setup' || options.stage === 'shutdown') && desired.length !== 0) ||
    !sameSchedule(desired, options.environment === 'preview' ? [] : ['* * * * *']) ||
    (options.stage === 'shutdown' && options.environment !== 'preview')
  )
    throw new DeploymentFailure('jobs.schedule');
  const previous = await readJobsSchedule(
    new MetadataClient(options),
    workerName('jobs', options.environment),
  );
  if (options.stage === 'setup' && previous.length !== 0)
    throw new DeploymentFailure('jobs.schedule');
  return { previous, desired, state: 'pending' };
}
export async function verifySavedSchedule(copy: string, receipt: DeploymentReceipt) {
  if (
    receipt.stage === 'shutdown' &&
    (receipt.environment !== 'preview' ||
      receipt.formatVersion !== 2 ||
      receipt.schedule?.desired.length !== 0)
  )
    throw new DeploymentFailure('receipt');
  if (!receipt.schedule) return;
  if (receipt.environment === 'preview' && receipt.schedule.desired.length !== 0)
    throw new DeploymentFailure('jobs.schedule');
  const config = object(
    JSON.parse(await readFile(join(copy, 'jobs', `wrangler.${receipt.environment}.json`), 'utf8')),
  );
  if (
    !sameSchedule(receipt.schedule.desired, boundedSchedules(object(config.triggers).crons)) ||
    (receipt.stage === 'setup' &&
      (receipt.schedule.previous.length || receipt.schedule.desired.length)) ||
    (receipt.status === 'active' && receipt.schedule.state !== 'confirmed')
  )
    throw new DeploymentFailure('receipt');
}
export async function scheduleUnchanged(client: MetadataClient, receipt: DeploymentReceipt) {
  if (!receipt.schedule) return; // Legacy preview receipts never acquire permission to alter schedules.
  const current = await readJobsSchedule(client, workerName('jobs', receipt.environment));
  const expected =
    receipt.schedule.state === 'pending' ? receipt.schedule.previous : receipt.schedule.desired;
  if (!sameSchedule(current, expected)) throw new DeploymentFailure('jobs.schedule');
}
async function putSchedule(options: DeploymentOptions, receipt: DeploymentReceipt, file: string) {
  const schedule = receipt.schedule;
  if (!schedule) throw new DeploymentFailure('receipt');
  await productionReleaseAllowed(options);
  await scheduleUnchanged(new MetadataClient(options), receipt);
  schedule.state = 'attempted';
  await saveReceipt(file, receipt); // No readiness gate remains between this checkpoint and PUT.
  const response = await (options.fetch ?? fetch)(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/workers/scripts/${workerName('jobs', options.environment)}/schedules`,
    {
      method: 'PUT',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(schedule.desired.map((cron) => ({ cron }))),
    },
  );
  // Even an acknowledged response needs an independent read. Never print its body.
  await response.body?.cancel();
}
export async function applySavedSchedule(
  receipt: DeploymentReceipt,
  file: string,
  options: DeploymentOptions,
  verifyActive: () => Promise<void>,
) {
  const schedule = receipt.schedule;
  if (!schedule) return;
  const client = new MetadataClient(options);
  await verifyActive();
  if (schedule.state === 'pending') {
    await scheduleUnchanged(client, receipt);
    if (!sameSchedule(schedule.previous, schedule.desired)) {
      await verifyActive();
      try {
        await putSchedule(options, receipt, file);
      } catch (error) {
        if (!scheduleAttempted(receipt)) throw error;
        // Only a request that reached its persisted checkpoint needs uncertain-write readback.
      }
    }
  }
  await confirmSchedule(receipt, file, client, verifyActive);
}
function scheduleAttempted(receipt: DeploymentReceipt): boolean {
  return receipt.schedule?.state === 'attempted';
}
async function confirmSchedule(
  receipt: DeploymentReceipt,
  file: string,
  client: MetadataClient,
  verifyActive: () => Promise<void>,
) {
  const schedule = receipt.schedule;
  if (!schedule) throw new DeploymentFailure('receipt');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await verifyActive();
    try {
      const current = await readJobsSchedule(client, workerName('jobs', receipt.environment));
      if (sameSchedule(current, schedule.desired)) {
        schedule.state = 'confirmed';
        await saveReceipt(file, receipt);
        return;
      }
      if (!sameSchedule(current, schedule.previous)) throw new DeploymentFailure('jobs.schedule');
    } catch (error) {
      if (error instanceof DeploymentFailure) throw error;
    }
  }
  // An attempted PUT is never repeated, even if the old schedule still appears.
  throw new DeploymentFailure('jobs.schedule');
}
