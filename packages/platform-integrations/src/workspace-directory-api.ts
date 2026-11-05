import { workspaceMaintenance } from '@lasvegasfortransit/platform-storage/workspace-maintenance';
import type { WorkspaceConnectorPolicy } from '@lasvegasfortransit/platform-core/workspace-connector';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  deferProvider,
  providerPause,
} from '@lasvegasfortransit/platform-storage/provider-backoff';
import {
  registerWorkspaceChannel,
  confirmWorkspaceChannel,
  validateWorkspaceChannel,
} from '@lasvegasfortransit/platform-storage/workspace-channels';
import {
  claimWorkspaceScan,
  saveWorkspaceScan,
  resetWorkspaceScan,
} from '@lasvegasfortransit/platform-storage/workspace-scans';

interface DirectoryContext {
  db: Db;
  input: Record<string, unknown>;
  customerId: string;
  now: Date;
}
interface ActionResult {
  status: number;
  body: object;
}
export function workspaceDirectoryAction(
  db: Db,
  input: Record<string, unknown>,
  policy: WorkspaceConnectorPolicy,
  now: Date,
): Promise<ActionResult | null> {
  const context = { db, input, customerId: policy.customerId, now };
  if (input.action === 'maintenance') return maintenance(context);
  if (input.action === 'backoff') return recordBackoff(context);
  if (typeof input.action === 'string' && input.action.startsWith('channel'))
    return channelAction(context);
  return scanAction(context);
}
async function recordBackoff({
  db,
  input,
  customerId,
  now,
}: DirectoryContext): Promise<ActionResult> {
  if (
    typeof input.retryAfterMs !== 'number' ||
    !Number.isFinite(input.retryAfterMs) ||
    input.retryAfterMs < 1000 ||
    input.retryAfterMs > 86400000
  )
    return { status: 400, body: { error: 'invalid_backoff' } };
  await deferProvider(db, {
    provider: 'google_workspace',
    contextId: customerId,
    pause: { retryAfterMs: input.retryAfterMs, global: true },
    now,
  });
  return { status: 200, body: { retryAfterMs: input.retryAfterMs } };
}
async function channelAction({
  db,
  input,
  customerId,
  now,
}: DirectoryContext): Promise<ActionResult | null> {
  if (input.action === 'channelRegister') {
    const pause = await providerPause(db, 'google_workspace', customerId, now);
    if (pause)
      return { status: 200, body: { registered: false, retryAfterMs: pause.retryAfterMs } };
    const body = await registerWorkspaceChannel(db, customerId, input, now);
    return { status: body ? 200 : 400, body: body ?? { error: 'invalid_channel' } };
  }
  if (input.action === 'channelConfirm')
    return current(await confirmWorkspaceChannel(db, customerId, input, now));
  if (input.action === 'channelValidate')
    return {
      status: 200,
      body: {
        valid: await validateWorkspaceChannel(db, customerId, input, now),
        retryAfterMs:
          (await providerPause(db, 'google_workspace', customerId, now))?.retryAfterMs ?? 0,
      },
    };
  return null;
}
async function scanAction({
  db,
  input,
  customerId,
  now,
}: DirectoryContext): Promise<ActionResult | null> {
  if (input.action === 'scanClaim') {
    const pause = await providerPause(db, 'google_workspace', customerId, now);
    return {
      status: 200,
      body: pause
        ? { kind: 'idle', retryAfterMs: pause.retryAfterMs }
        : ((await claimWorkspaceScan(db, customerId, now)) ?? { kind: 'idle' }),
    };
  }
  if (input.action === 'scanReset')
    return current(await resetWorkspaceScan(db, customerId, input, now));
  if (input.action === 'scanSave')
    return current(await saveWorkspaceScan(db, customerId, input, now));
  return null;
}
function current(ok: boolean): ActionResult {
  return { status: ok ? 200 : 409, body: { current: ok } };
}

async function maintenance({ db, customerId, now }: DirectoryContext): Promise<ActionResult> {
  return { status: 200, body: await workspaceMaintenance(db, customerId, now) };
}
