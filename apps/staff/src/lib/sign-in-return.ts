import { staffWelcomePath } from './onboarding';
import { SESSION_COOKIE, safeNext } from '@lasvegasfortransit/platform-core/web-auth';
import { can } from '@lasvegasfortransit/platform-core/permissions';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { readStaffSession } from './staff-session';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import type { AccessIdentity } from '@lasvegasfortransit/platform-integrations/access-identity';
import type { StaffEnv } from './context';
import { getInitialStaffAdminState } from './initial-admin';
import { messageResponse } from './responses';

export function staffReturnPath(next: string): string {
  return `/sign-in/return/?next=${encodeURIComponent(safeNext(next))}`;
}

/** Recheck the newly installed session before choosing a staff destination. */
export function throughStaffReturn(response: Response): Response {
  const next = response.headers.get('Location');
  if (
    !next ||
    !response.headers
      .getSetCookie()
      .some(
        (cookie) =>
          cookie.startsWith(`${SESSION_COOKIE}=`) && !cookie.startsWith(`${SESSION_COOKIE}=;`),
      )
  )
    return response;
  const headers = new Headers(response.headers);
  headers.set('Location', staffWelcomePath(next));
  return new Response(response.body, { status: response.status, headers });
}

export async function staffSignInReturn(
  env: StaffEnv,
  request: Request,
  access?: AccessIdentity,
): Promise<Response> {
  const session = await readStaffSession(env, request, access);
  if (!session) return new Response(null, { status: 303, headers: { Location: '/sign-in/' } });
  const actor = await loadActor(env.PLATFORM_DB, session.personId);
  if (
    !(actor?.organizationAuthenticated ?? actor?.workspaceLinked) ||
    !can(actor, 'attendance.record')
  )
    return messageResponse(t('staff.common.accessDenied'), 403);
  const next = safeNext(new URL(request.url).searchParams.get('next'));
  if (
    next === '/sign-in/initial-admin/' &&
    (await getInitialStaffAdminState(env, request, access)).kind === 'ready'
  )
    return new Response(null, { status: 303, headers: { Location: next } });
  const destination = can(actor, 'console.enter')
    ? next === '/account/' || next.startsWith('/sign-in/') || next === '/sign-out/'
      ? '/'
      : next
    : ['/paper/', '/paper/sheet/'].includes(next.split('?')[0] ?? '')
      ? next
      : '/paper/';
  return new Response(null, { status: 303, headers: { Location: destination } });
}
