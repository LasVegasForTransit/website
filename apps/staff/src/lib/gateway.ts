import { requestFailure, recoverStaffResponse } from './request-failure';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { verifyAccessAssertion } from '@lasvegasfortransit/platform-integrations/access-identity';
import {
  staffOriginAllowed,
  staffAuthMode,
} from '@lasvegasfortransit/platform-integrations/staff-auth-config';
import type { StaffEnv } from './context';
import { messageResponse, privateResponse } from './responses';
import { authFormOrigins } from './auth-form-origins';
export async function guardStaffGateway(
  request: Request,
  env: StaffEnv,
  context: { next: () => Promise<Response>; fetch?: typeof fetch },
): Promise<Response> {
  try {
    const mode = staffAuthMode(env);
    if (!mode) return messageResponse(t('staff.common.signInUnavailable'), 503);
    if (
      !staffOriginAllowed(env, new URL(request.url).origin) ||
      (mode === 'cloudflare-access' &&
        !(await verifyAccessAssertion(request, env, { fetch: context.fetch })))
    )
      return messageResponse(t('staff.common.accessDenied'), 403);
    return privateResponse(
      recoverStaffResponse(await context.next()),
      new URL(request.url).pathname,
      authFormOrigins(env, new URL(request.url)),
    );
  } catch (error) {
    return requestFailure(error, 'gateway');
  }
}
