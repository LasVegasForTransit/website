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
      return messageResponse("You don't have access to this", 403);
    if (!env.PLATFORM_DB || !env.LVBT_SIGN_IN_SECRET)
      return messageResponse('Staff sign-in is unavailable. Please try again later.', 503);
    const platform = {
      ...env,
      PLATFORM_DB: env.PLATFORM_DB,
      LVBT_SIGN_IN_SECRET: env.LVBT_SIGN_IN_SECRET,
    };
    const access = await verifyAccessAssertion(request, env, { fetch: context.fetch });
    if (!access) return messageResponse("You don't have access to this", 403);
    context.locals.access = access;
    if (!/^\/sign-in(?:\/|$)/.test(new URL(request.url).pathname)) {
      const staff = await resolveStaffContext(request, platform, access);
      if (staff instanceof Response) return privateResponse(staff);
      context.locals.staff = staff;
    }
    if (request.method === 'POST' && request.headers.get('Origin') !== new URL(request.url).origin)
      return messageResponse('Reload this page and try again.', 403);
    return privateResponse(await context.next());
  } catch {
    return messageResponse('We couldn’t load this page. Please try again.', 503);
  }
}
