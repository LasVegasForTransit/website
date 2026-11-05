import {
  connectorPolicy,
  type WorkspaceConnectorPolicy,
} from '@lasvegasfortransit/platform-core/workspace-connector';
import type { DirectoryAccount } from '@lasvegasfortransit/platform-core/workspace-onboarding';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { enrollWorkspaceAccount } from '@lasvegasfortransit/platform-storage/workspace-enrollment';
import { workspaceDirectoryAction } from './workspace-directory-api';
import { providerPause } from '@lasvegasfortransit/platform-storage/provider-backoff';
import { workspaceBudget } from '@lasvegasfortransit/platform-storage/workspace-budget';
import { verifyWorkspaceWorkload } from './workspace-connector-auth';
import {
  claimWorkspaceGroup,
  workspaceGroupCurrent,
  prepareWorkspaceGroup,
  observeWorkspaceGroup,
  finishWorkspaceGroup,
} from '@lasvegasfortransit/platform-storage/workspace-connector';
export interface WorkspaceConnectorEnv {
  PLATFORM_DB: Db;
  LVBT_DEPLOYMENT_ENV?: string;
  LVBT_WORKSPACE_ONBOARDING_ENABLED?: string;
  LVBT_WORKSPACE_CONNECTOR_SUBJECT?: string;
  LVBT_WORKSPACE_CONNECTOR_AUDIENCE?: string;
  LVBT_WORKSPACE_ONBOARDING_CONFIG?: string;
}
function reply(status: number, body: object) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
async function body(request: Request): Promise<Record<string, unknown> | Response> {
  const reader = request.body?.getReader();
  if (!reader) return reply(400, { error: 'invalid_body' });
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let size = 0,
    text = '';
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      const chunk: unknown = part.value;
      if (!(chunk instanceof Uint8Array)) return reply(400, { error: 'invalid_body' });
      size += chunk.byteLength;
      if (size > 65536) {
        await reader.cancel();
        return reply(413, { error: 'body_too_large' });
      }
      text += decoder.decode(chunk, { stream: true });
    }
    const value: unknown = JSON.parse(text + decoder.decode());
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : reply(400, { error: 'invalid_body' });
  } catch {
    return reply(400, { error: 'invalid_body' });
  } finally {
    reader.releaseLock();
  }
}
function configuration(env: WorkspaceConnectorEnv): WorkspaceConnectorPolicy | null {
  try {
    return connectorPolicy(JSON.parse(env.LVBT_WORKSPACE_ONBOARDING_CONFIG ?? ''));
  } catch {
    return null;
  }
}
type GroupFailure = NonNullable<Parameters<typeof finishWorkspaceGroup>[1]['failure']>;
function failureValue(value: unknown): GroupFailure | null {
  if (!value || typeof value !== 'object') return null;
  const f = value as Record<string, unknown>;
  if (
    !['unknown', 'permission_denied', 'provider_unavailable', 'rate_limited'].includes(
      String(f.kind),
    ) ||
    typeof f.retryAfterMs !== 'number' ||
    !Number.isFinite(f.retryAfterMs) ||
    f.retryAfterMs < 1000 ||
    f.retryAfterMs > 86400000 ||
    !(f.resourceId === null || typeof f.resourceId === 'string') ||
    !(f.reviewReason === undefined || f.reviewReason === 'inherited_access')
  )
    return null;
  return value as GroupFailure;
}
async function claimAction(
  db: Db,
  input: Record<string, unknown>,
  policy: WorkspaceConnectorPolicy,
  now: Date,
) {
  const pause = await providerPause(db, 'google_workspace', policy.customerId, now);
  if (pause) return reply(200, { kind: 'idle', retryAfterMs: pause.retryAfterMs });
  const personId = input.personId;
  if (personId !== undefined && (typeof personId !== 'string' || !/^[\w-]{1,128}$/.test(personId)))
    return reply(400, { error: 'invalid_person' });
  return reply(200, (await claimWorkspaceGroup(db, policy, now, personId)) ?? { kind: 'idle' });
}
async function groupAction(
  db: Db,
  input: Record<string, unknown>,
  policy: WorkspaceConnectorPolicy,
  now: Date,
) {
  if (input.action === 'claim') return claimAction(db, input, policy, now);
  if (typeof input.token !== 'string') return reply(400, { error: 'invalid_token' });
  if (input.action === 'current')
    return reply(200, { current: await workspaceGroupCurrent(db, input.token, policy, now) });
  let ok = false;
  if (
    input.action === 'prepare' &&
    typeof input.resourceId === 'string' &&
    typeof input.wasGranted === 'boolean'
  )
    ok = await prepareWorkspaceGroup(
      db,
      { token: input.token, resourceId: input.resourceId, wasGranted: input.wasGranted },
      policy,
      now,
    );
  else if (input.action === 'observed')
    ok = await observeWorkspaceGroup(
      db,
      { token: input.token, observed: input.observation },
      policy,
      now,
    );
  else if (input.action === 'finish') {
    const failure = input.failure === undefined ? undefined : failureValue(input.failure);
    if (failure === null) return reply(400, { error: 'invalid_failure' });
    ok = await finishWorkspaceGroup(
      db,
      { token: input.token, ...(failure ? { failure } : {}) },
      policy,
      now,
    );
  }
  return reply(ok ? 200 : 409, { current: ok });
}
async function executeAction(
  db: Db,
  input: Record<string, unknown>,
  policy: WorkspaceConnectorPolicy,
  now: Date,
) {
  if (input.action === 'enroll')
    return reply(
      200,
      await enrollWorkspaceAccount(db, input.account as DirectoryAccount, policy, now),
    );
  if (input.action === 'enrollBatch') {
    if (!Array.isArray(input.accounts) || input.accounts.length === 0 || input.accounts.length > 20)
      return reply(400, { error: 'invalid_batch' });
    const results = [];
    for (const account of input.accounts)
      results.push(await enrollWorkspaceAccount(db, account as DirectoryAccount, policy, now));
    return reply(200, { results });
  }
  if (['claim', 'current', 'prepare', 'observed', 'finish'].includes(String(input.action)))
    return groupAction(db, input, policy, now);
  const directory = await workspaceDirectoryAction(db, input, policy, now);
  if (directory) return reply(directory.status, directory.body);
  return reply(400, { error: 'unknown_action' });
}
export async function workspaceConnectorRequest(
  env: WorkspaceConnectorEnv,
  request: Request,
  options: { fetch?: typeof fetch; now?: () => Date } = {},
): Promise<Response> {
  if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
  const policy = configuration(env),
    subject = env.LVBT_WORKSPACE_CONNECTOR_SUBJECT,
    audience = env.LVBT_WORKSPACE_CONNECTOR_AUDIENCE;
  if (!policy || !subject || !audience || !ready(env, policy))
    return reply(503, { error: 'not_configured' });
  const now = (options.now ?? systemNow)();
  if (
    request.url !== audience ||
    !(await verifyWorkspaceWorkload(request, { subject, audience }, { ...options, now }))
  )
    return reply(401, { error: 'unauthorized' });
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json')
    return reply(400, { error: 'invalid_content_type' });
  const input = await body(request);
  if (input instanceof Response) return input;
  if (
    ![
      'enroll',
      'enrollBatch',
      'claim',
      'current',
      'prepare',
      'observed',
      'finish',
      'maintenance',
      'channelRegister',
      'channelConfirm',
      'channelValidate',
      'scanClaim',
      'scanSave',
      'scanReset',
      'backoff',
    ].includes(String(input.action))
  )
    return reply(400, { error: 'unknown_action' });
  const result = await workspaceBudget(
    env.PLATFORM_DB,
    policy.environment,
    (db) => executeAction(db, input, policy, now),
    now,
  );
  return result.allowed
    ? result.result
    : reply(429, { error: 'google_work_budget', retryAfterMs: 60000 });
}

function ready(env: WorkspaceConnectorEnv, policy: WorkspaceConnectorPolicy) {
  return (
    env.LVBT_WORKSPACE_ONBOARDING_ENABLED === 'true' &&
    (env.LVBT_DEPLOYMENT_ENV === undefined || env.LVBT_DEPLOYMENT_ENV === policy.environment)
  );
}

const systemNow = () => new Date();
