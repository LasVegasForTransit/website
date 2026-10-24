import {
  SESSION_COOKIE,
  readCookie,
  safeNext,
  sessionCookies,
} from '@lasvegasfortransit/platform-core/web-auth';
import {
  createSsoSession,
  readSsoSession,
  SsoLinkService,
  ssoPrincipalStatus,
} from '@lasvegasfortransit/platform-storage/staff-sso';
import {
  googleResponse,
  PENDING_COOKIE,
  workspaceCookie,
} from '@lasvegasfortransit/platform-integrations/google-sign-in';
import type { AccessIdentity } from '@lasvegasfortransit/platform-integrations/access-identity';
import { staffWelcomePath } from './onboarding';
import { isSignedOut } from './sso-navigation';
import { staffReturnPath } from './sign-in-return';
import type { StaffEnv } from './context';
import { messageResponse } from './responses';

/** A gateway-authenticated GET can continue without another identity-provider prompt. */
export async function startSsoSignIn(
  env: StaffEnv,
  request: Request,
  principal: AccessIdentity,
): Promise<Response | null> {
  const notice = new URL(request.url).searchParams;
  if (notice.get('administrator_removed') === '1' || notice.get('deleted') === '1') return null;
  if (await isSignedOut(env, request, principal)) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return messageResponse('Reload this page to continue signing in.', 403);
  const hasAdministrator = await env.PLATFORM_DB.prepare(
    'SELECT 1 FROM staff_administrators LIMIT 1',
  ).first();
  const next = safeNext(
    new URL(request.url).searchParams.get('next') ??
      (hasAdministrator ? '/' : '/sign-in/initial-admin/'),
  );
  const token = readCookie(request, SESSION_COOKIE);
  if (token && (await readSsoSession(env, token, principal)))
    return googleResponse(staffReturnPath(next));
  const session = await createSsoSession(env, principal);
  if (session)
    return googleResponse(staffWelcomePath(next), sessionCookies(session.token, session.expiresAt));
  if ((await ssoPrincipalStatus(env.PLATFORM_DB, principal)) !== 'unknown')
    return messageResponse("You don't have access to this", 403);
  const pending = await new SsoLinkService(env).begin(principal, { returnTo: next });
  const destination = new URL(request.url).searchParams.has('membership_confirmation_expired')
    ? '/sign-in/link-account/?expired=1'
    : '/sign-in/link-account/';
  return googleResponse(destination, [workspaceCookie(PENDING_COOKIE, pending, 900)]);
}
