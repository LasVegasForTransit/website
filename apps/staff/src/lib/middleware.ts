import { requestFailure, recoverStaffResponse } from './request-failure';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { verifyAccessAssertion } from '@lasvegasfortransit/platform-integrations/access-identity';
import { resolveStaffContext, type StaffEnv, type StaffLocals } from './context';
import { messageResponse, privateResponse } from './responses';
export { staffOriginAllowed } from '@lasvegasfortransit/platform-integrations/staff-auth-config';
import {
  staffAuthMode,
  staffOriginAllowed,
} from '@lasvegasfortransit/platform-integrations/staff-auth-config';
export async function staffMiddleware(
  request: Request,
  env: Partial<StaffEnv>,
  context: { locals: StaffLocals; next: () => Promise<Response>; fetch?: typeof fetch },
): Promise<Response> {
  try {
    const mode = staffAuthMode(env);
    if (!mode) return messageResponse(t('staff.common.signInUnavailable'), 503);
    if (!staffOriginAllowed(env, new URL(request.url).origin))
      return messageResponse(t('staff.common.accessDenied'), 403);
    if (!env.PLATFORM_DB || !env.LVBT_SIGN_IN_SECRET)
      return messageResponse(t('staff.common.signInUnavailable'), 503);
    const platform = {
      ...env,
      PLATFORM_DB: env.PLATFORM_DB,
      LVBT_SIGN_IN_SECRET: env.LVBT_SIGN_IN_SECRET,
    };
    const access =
      mode === 'cloudflare-access'
        ? await verifyAccessAssertion(request, env, { fetch: context.fetch })
        : undefined;
    if (mode === 'cloudflare-access' && !access)
      return messageResponse(t('staff.common.accessDenied'), 403);
    context.locals.access = access ?? undefined;
    if (request.method === 'POST' && request.headers.get('Origin') !== new URL(request.url).origin)
      return messageResponse(t('staff.common.reload'), 403);
    if (!/^\/sign-in(?:\/|$)/.test(new URL(request.url).pathname)) {
      const staff = await resolveStaffContext(request, platform, access ?? undefined);
      if (staff instanceof Response) return privateResponse(staff);
      context.locals.staff = staff;
    }

    return privateResponse(
      recoverStaffResponse(await context.next()),
      new URL(request.url).pathname,
    );
  } catch (error) {
    return requestFailure(error, 'middleware');
  }
}
