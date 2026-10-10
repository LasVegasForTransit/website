import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { object } from './preflight-api';
import type { StaffRelease } from './release-artifact';
import type { Environment } from './preflight-config';

export type App = 'staff' | 'jobs';
export interface Traffic {
  versionId: string;
  percentage: number;
}
export interface WorkerReceipt {
  app: App;
  name: string;
  versionId: string;
  active: boolean;
  previousVersions: Traffic[];
  deploymentId?: string;
}
export interface DeploymentReceipt {
  formatVersion: 1;
  commit: string;
  releaseId: string;
  artifactHash: string;
  accountId: string;
  environment: Environment;
  status: 'uploading' | 'uploaded' | 'activating' | 'active' | 'failed';
  workers: WorkerReceipt[];
}
export function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
}
export function workerName(app: App, environment: Environment) {
  return `lvbt-${app}${environment === 'preview' ? '-preview' : ''}`;
}
export function validateTraffic(value: unknown): Traffic[] {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    throw new Error('Invalid version traffic.');
  const result = value
    .map((entry: unknown) => {
      const row = object(entry);
      if (
        !uuid(row.versionId) ||
        typeof row.percentage !== 'number' ||
        !Number.isFinite(row.percentage) ||
        row.percentage <= 0 ||
        row.percentage > 100 ||
        Object.keys(row).sort().join() !== 'percentage,versionId'
      )
        throw new Error('Invalid version traffic.');
      return { versionId: row.versionId, percentage: row.percentage };
    })
    .sort((a, b) => a.versionId.localeCompare(b.versionId));
  if (
    result.reduce((sum, row) => sum + row.percentage, 0) !== 100 ||
    new Set(result.map((row) => row.versionId)).size !== result.length
  )
    throw new Error('Invalid version traffic.');
  return result;
}
export function newReceipt(
  release: StaffRelease,
  accountId: string,
  environment: Environment,
): DeploymentReceipt {
  return {
    formatVersion: 1,
    commit: release.commit,
    releaseId: release.releaseId,
    artifactHash: release.artifactHash,
    accountId,
    environment,
    status: 'uploading',
    workers: [],
  };
}
export async function readReceipt(
  file: string,
  expected: DeploymentReceipt,
): Promise<DeploymentReceipt> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024)
    throw new Error('Invalid receipt.');
  const receipt = object(JSON.parse(await readFile(file, 'utf8')));
  if (
    Object.keys(receipt).sort().join() !== Object.keys(expected).sort().join() ||
    ['formatVersion', 'commit', 'releaseId', 'artifactHash', 'accountId', 'environment'].some(
      (key) => receipt[key] !== object(expected)[key],
    ) ||
    !['uploaded', 'activating', 'active', 'failed'].includes(String(receipt.status)) ||
    !Array.isArray(receipt.workers) ||
    receipt.workers.length !== 2
  )
    throw new Error('Receipt does not match the selected release and environment.');
  const workers = receipt.workers.map((value: unknown, index: number): WorkerReceipt => {
    const worker = object(value);
    const app = (['staff', 'jobs'] as const)[index];
    if (
      worker.app !== app ||
      worker.name !== workerName(app, expected.environment) ||
      !uuid(worker.versionId) ||
      typeof worker.active !== 'boolean' ||
      (worker.deploymentId !== undefined && !uuid(worker.deploymentId)) ||
      (worker.active && !uuid(worker.deploymentId)) ||
      Object.keys(worker).some(
        (key) =>
          !['app', 'name', 'versionId', 'active', 'deploymentId', 'previousVersions'].includes(key),
      )
    )
      throw new Error('Incomplete or invalid Worker receipt.');
    return {
      app,
      name: worker.name,
      versionId: worker.versionId,
      active: worker.active,
      previousVersions: validateTraffic(worker.previousVersions),
      ...(worker.deploymentId ? { deploymentId: worker.deploymentId } : {}),
    };
  });
  return { ...expected, status: receipt.status as DeploymentReceipt['status'], workers };
}
export async function saveReceipt(file: string, receipt: DeploymentReceipt) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function withReceiptLock<T>(directory: string, file: string, run: () => Promise<T>) {
  const location = relative(resolve(directory), resolve(file));
  if (!location || (!isAbsolute(location) && location !== '..' && !location.startsWith('../')))
    throw new Error('Keep deployment receipts outside the saved artifact.');
  const lock = await open(`${file}.lock`, 'wx', 0o600);
  try {
    return await run();
  } finally {
    await lock.close();
    await rm(`${file}.lock`);
  }
}
