import { readStaffSession } from './staff-session';
import { bootstrapSsoStaffAdmin } from '@lasvegasfortransit/platform-storage/staff-sso';
import type { AccessIdentity } from '@lasvegasfortransit/platform-integrations/access-identity';
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
      session: NonNullable<Awaited<ReturnType<typeof readStaffSession>>>;
    };

async function resolveInitialStaffAdminState(
  env: StaffEnv,
  request: Request,
  access?: AccessIdentity,
): Promise<InternalInitialAdminState> {
  try {
    const existing = await env.PLATFORM_DB.prepare(
      'SELECT 1 AS present FROM staff_administrators LIMIT 1',
    ).first();
    if (existing) return { kind: 'already_initialized' };

    const expectedEmail = env.LVBT_INITIAL_STAFF_ADMIN_WORKSPACE_EMAIL?.trim().toLowerCase();
    if (!expectedEmail) return { kind: 'unconfigured' };

    const session = await readStaffSession(env, request, access);
    if (!session) return { kind: 'needs_sign_in' };
    if (session.email !== expectedEmail) return { kind: 'not_authorized' };

    const actor = await loadActor(env.PLATFORM_DB, session.personId);
    if (
      actor?.membershipStatus !== 'member' ||
      !(actor.organizationAuthenticated ?? actor.workspaceLinked)
    )
      return { kind: 'not_authorized' };

    return {
      kind: 'ready',
      personId: session.personId,
      session,
    };
  } catch {
    return { kind: 'unavailable' };
  }
}

export async function getInitialStaffAdminState(
  env: StaffEnv,
  request: Request,
  access?: AccessIdentity,
): Promise<InitialStaffAdminState> {
  const state = await resolveInitialStaffAdminState(env, request, access);
  return state.kind === 'ready' ? { kind: 'ready' } : state;
}

export async function bootstrapInitialStaffAdmin(
  env: StaffEnv,
  request: Request,
  access?: AccessIdentity,
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
  const input = {
    presidentPersonId: state.personId,
    performedBy: 'initial_staff_admin_setup',
    operationId: crypto.randomUUID(),
  };
  const result =
    state.session.mode === 'google'
      ? await bootstrapStaffAdmin(env.PLATFORM_DB, {
          ...input,
          workspaceSubject: state.session.workspaceSubject,
        })
      : await bootstrapSsoStaffAdmin(env.PLATFORM_DB, {
          ...input,
          principal: state.session.principal,
        });
  if (result.kind === 'ok') return { kind: 'ok' };
  if (result.kind === 'conflict') return { kind: 'already_initialized' };
  if (result.kind === 'invalid') return { kind: 'not_authorized' };
  return { kind: 'unavailable' };
}
