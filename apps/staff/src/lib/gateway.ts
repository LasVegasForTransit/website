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
      return messageResponse("You don't have access to this", 403);
    return privateResponse(await context.next());
  } catch {
    return messageResponse('We couldn’t load this page. Please try again.', 503);
  }
}
