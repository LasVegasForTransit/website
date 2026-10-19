import { requestFailure, recoverStaffResponse } from './request-failure';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { verifyAccessAssertion } from '@lasvegasfortransit/platform-integrations/access-identity';
import { resolveStaffContext, type StaffEnv, type StaffLocals } from './context';
import { messageResponse, privateResponse } from './responses';
export function staffOriginAllowed(env: Partial<StaffEnv>, origin: string): boolean {
  if (
    [
      'https://staff.lasvegasfortransit.org',
      'https://staff-preview.lasvegasfortransit.org',
    ].includes(origin)
  )
    return true;
  try {
    const allowed: unknown = JSON.parse(env.LVBT_GOOGLE_PREVIEW_ORIGINS ?? '[]');
    return (
      Array.isArray(allowed) &&
      allowed.includes(origin) &&
      /^https:\/\/[a-z0-9-]*lvbt-staff-preview\.[a-z0-9-]+\.workers\.dev$/.test(origin)
    );
  } catch {
    return false;
  }
}
export async function staffMiddleware(
  request: Request,
  env: Partial<StaffEnv>,
  context: { locals: StaffLocals; next: () => Promise<Response>; fetch?: typeof fetch },
): Promise<Response> {
  try {
    if (!staffOriginAllowed(env, new URL(request.url).origin))
      return messageResponse(t('staff.common.accessDenied'), 403);
    if (!env.PLATFORM_DB || !env.LVBT_SIGN_IN_SECRET)
      return messageResponse(t('staff.common.signInUnavailable'), 503);
    const platform = {
      ...env,
      PLATFORM_DB: env.PLATFORM_DB,
      LVBT_SIGN_IN_SECRET: env.LVBT_SIGN_IN_SECRET,
    };
    const access = await verifyAccessAssertion(request, env, { fetch: context.fetch });
    if (!access) return messageResponse(t('staff.common.accessDenied'), 403);
    context.locals.access = access;
    if (!/^\/sign-in(?:\/|$)/.test(new URL(request.url).pathname)) {
      const staff = await resolveStaffContext(request, platform, access);
      if (staff instanceof Response) return privateResponse(staff);
      context.locals.staff = staff;
    }
    if (request.method === 'POST' && request.headers.get('Origin') !== new URL(request.url).origin)
      return messageResponse(t('staff.common.reload'), 403);
    return privateResponse(
      recoverStaffResponse(await context.next()),
      new URL(request.url).pathname,
    );
  } catch (error) {
    return requestFailure(error, 'middleware');
  }
}
