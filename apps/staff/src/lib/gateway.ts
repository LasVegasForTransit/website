import { requestFailure, recoverStaffResponse } from './request-failure';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { verifyAccessAssertion } from '@lasvegasfortransit/platform-integrations/access-identity';
import { staffOriginAllowed } from './middleware';
import type { StaffEnv } from './context';
import { messageResponse, privateResponse } from './responses';
export async function guardStaffGateway(
  request: Request,
  env: StaffEnv,
  context: { next: () => Promise<Response>; fetch?: typeof fetch },
): Promise<Response> {
  try {
    if (
      !staffOriginAllowed(env, new URL(request.url).origin) ||
      !(await verifyAccessAssertion(request, env, { fetch: context.fetch }))
    )
      return messageResponse(t('staff.common.accessDenied'), 403);
    return privateResponse(
      recoverStaffResponse(await context.next()),
      new URL(request.url).pathname,
    );
  } catch (error) {
    return requestFailure(error, 'gateway');
  }
}
