import { SESSION_COOKIE, readCookie } from '@lasvegasfortransit/platform-core/web-auth';
import type { AccessIdentity } from '@lasvegasfortransit/platform-integrations/access-identity';
import { readWorkspaceSession } from '@lasvegasfortransit/platform-storage/workspace-link';
import { bootstrapStaffAdmin, loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import type { StaffEnv } from './context';
import { staffOriginAllowed } from './middleware';

export type InitialStaffAdminState =
  | { kind: 'already_initialized' }
  | { kind: 'unconfigured' }
  | { kind: 'needs_sign_in' }
  | { kind: 'not_authorized' }
  | { kind: 'unavailable' }
  | { kind: 'ready' };

export type InitialStaffAdminResult =
  InitialStaffAdminState | { kind: 'ok' } | { kind: 'invalid_request' };

type InitialStaffAdminNonReadyState = Exclude<InitialStaffAdminState, { kind: 'ready' }>;
type InternalInitialAdminState =
  | InitialStaffAdminNonReadyState
  | {
      kind: 'ready';
      personId: string;
      workspaceSubject: string;
    };

async function resolveInitialStaffAdminState(
  env: StaffEnv,
  request: Request,
  access: AccessIdentity,
): Promise<InternalInitialAdminState> {
  try {
    const existing = await env.PLATFORM_DB.prepare(
      'SELECT 1 AS present FROM staff_administrators LIMIT 1',
    ).first();
    if (existing) return { kind: 'already_initialized' };

    const expectedEmail = env.LVBT_INITIAL_STAFF_ADMIN_WORKSPACE_EMAIL?.trim().toLowerCase();
    if (!expectedEmail) return { kind: 'unconfigured' };

    const token = readCookie(request, SESSION_COOKIE);
    if (!token) return { kind: 'needs_sign_in' };
    const session = await readWorkspaceSession(env, token);
    if (!session) return { kind: 'needs_sign_in' };
    if (
      session.workspaceEmail !== expectedEmail ||
      session.workspaceEmail !== access.email.toLowerCase()
    )
      return { kind: 'not_authorized' };

    const actor = await loadActor(env.PLATFORM_DB, session.personId);
    if (actor?.membershipStatus !== 'member' || !actor.workspaceLinked)
      return { kind: 'not_authorized' };

    return {
      kind: 'ready',
      personId: session.personId,
      workspaceSubject: session.workspaceSubject,
    };
  } catch {
    return { kind: 'unavailable' };
  }
}

export async function getInitialStaffAdminState(
  env: StaffEnv,
  request: Request,
  access: AccessIdentity,
): Promise<InitialStaffAdminState> {
  const state = await resolveInitialStaffAdminState(env, request, access);
  return state.kind === 'ready' ? { kind: 'ready' } : state;
}

export async function bootstrapInitialStaffAdmin(
  env: StaffEnv,
  request: Request,
  access: AccessIdentity,
): Promise<InitialStaffAdminResult> {
  const url = new URL(request.url);
  if (
    request.method !== 'POST' ||
    request.headers.get('Origin') !== url.origin ||
    !staffOriginAllowed(env, url.origin)
  )
    return { kind: 'invalid_request' };

  const state = await resolveInitialStaffAdminState(env, request, access);
  if (state.kind !== 'ready') return state;
  const result = await bootstrapStaffAdmin(env.PLATFORM_DB, {
    presidentPersonId: state.personId,
    workspaceSubject: state.workspaceSubject,
    performedBy: 'initial_staff_admin_setup',
    operationId: crypto.randomUUID(),
  });
  if (result.kind === 'ok') return { kind: 'ok' };
  if (result.kind === 'conflict') return { kind: 'already_initialized' };
  if (result.kind === 'invalid') return { kind: 'not_authorized' };
  return { kind: 'unavailable' };
}
