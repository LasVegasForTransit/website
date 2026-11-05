import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DirectoryAccount } from '@lasvegasfortransit/platform-core/workspace-onboarding';
import type { ConnectorConfig } from './config';
import type { Directory } from './directory';
import type { Site } from './site';
import { ConnectorFailure, record } from './http';
export const EVENTS = ['add', 'update', 'delete', 'undelete'] as const;
export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('base64url');
}
export async function renewChannels(
  config: ConnectorConfig,
  directory: Directory,
  site: Site,
  options: { now: Date; events: unknown },
) {
  const { now } = options;
  const events = dueEvents(options.events);
  for (const event of events) {
    const id = `${event}.${randomUUID()}`,
      token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + 3600000).toISOString();
    if (
      (await site.action('channelRegister', { id, event, tokenHash: tokenHash(token), expiresAt }))
        .registered !== true
    )
      continue;
    const query = new URLSearchParams({ customer: config.customerId, event });
    const channel = await directory.call(`/users/watch?${query}`, {
      method: 'POST',
      body: JSON.stringify({
        id,
        type: 'web_hook',
        address: `${config.origin}/notifications`,
        token,
        expiration: String(Date.parse(expiresAt)),
      }),
    });
    if (
      channel.id !== id ||
      typeof channel.resourceId !== 'string' ||
      !/^\d+$/.test(String(channel.expiration))
    )
      throw new ConnectorFailure('invalid_response');
    const expiration = Number(channel.expiration);
    if (expiration <= now.getTime() || expiration > now.getTime() + 86400000)
      throw new ConnectorFailure('invalid_response');
    await site.action('channelConfirm', {
      id,
      resourceId: channel.resourceId,
      expiresAt: new Date(expiration).toISOString(),
    });
  }
}
interface Scan {
  token: string;
  pageToken: string | null;
  phase: 'active' | 'deleted';
  offset: number;
}
export async function recover(
  directory: Directory,
  site: Site,
  context: { now: () => Date; deadline: number; config: ConnectorConfig },
  raw: unknown,
) {
  const claimed = record(raw);
  if (claimed.kind === 'idle') return;
  const scan = claimed as unknown as Scan;
  validateScan(scan);
  const page = await readPage(directory, site, scan);
  if (!page) return;
  let offset = scan.offset;
  let accounts: DirectoryAccount[] = [];
  for (
    ;
    offset < page.users.length && context.now().getTime() < context.deadline - 8000;
    offset++
  ) {
    const account = await directory.observation(
      record(page.users[offset]),
      scan.phase === 'deleted',
      page.observedAt,
    );
    if (!permitted(context.config, account.userId)) continue;
    accounts.push(account);
    if (accounts.length === 20) {
      await site.action('enrollBatch', { accounts });
      accounts = [];
    }
  }
  if (accounts.length) await site.action('enrollBatch', { accounts });
  await site.action('scanSave', checkpoint(scan, page, offset));
}
function validateScan(scan: Scan) {
  if (
    typeof scan.token !== 'string' ||
    !['active', 'deleted'].includes(scan.phase) ||
    !Number.isSafeInteger(scan.offset) ||
    scan.offset < 0 ||
    !(scan.pageToken === null || typeof scan.pageToken === 'string')
  )
    throw new ConnectorFailure('invalid_response');
}
function permitted(config: ConnectorConfig, userId: string) {
  return config.environment !== 'preview' || config.previewUserIds?.includes(userId) === true;
}
function checkpoint(
  scan: Scan,
  page: { users: unknown[]; nextPageToken: string | null },
  offset: number,
) {
  const partial = offset < page.users.length;
  const complete = !partial && !page.nextPageToken && scan.phase === 'deleted';
  return {
    token: scan.token,
    pageToken: partial ? scan.pageToken : page.nextPageToken,
    phase: !partial && !page.nextPageToken && scan.phase === 'active' ? 'deleted' : scan.phase,
    offset: partial ? offset : 0,
    complete,
  };
}

async function readPage(directory: Directory, site: Site, scan: Scan) {
  try {
    return await directory.page(scan.phase, scan.pageToken);
  } catch (error) {
    if (!(error instanceof ConnectorFailure) || error.kind !== 'expired_page_token') throw error;
    await site.accepted('scanReset', { token: scan.token });
    return null;
  }
}

function dueEvents(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 4 ||
    !value.every((event: unknown) => typeof event === 'string' && EVENTS.some((e) => e === event))
  )
    throw new ConnectorFailure('invalid_response');
  return [...new Set(value as string[])];
}
