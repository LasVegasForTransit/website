import { field } from '../lib/forms';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import { endSession } from '@lasvegasfortransit/platform-storage/auth';
import {
  clearedSessionCookies,
  readCookie,
  SESSION_COOKIE,
} from '@lasvegasfortransit/platform-core/web-auth';
import { googleResponse } from '@lasvegasfortransit/platform-integrations/google-sign-in';
import { messageResponse } from '../lib/responses';
import type { StaffEnv } from '../lib/context';
export const POST: APIRoute = async ({ request, locals }) => {
  const staff = locals.staff;
  if (!staff) return messageResponse("You don't have access to this", 403);
  const form = await request.formData();
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: 'sign-out',
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse(
      'This form expired or was already submitted. Reload the page and try again.',
      409,
    );
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await endSession(env as unknown as StaffEnv, token);
  return googleResponse('/sign-in/', clearedSessionCookies());
};
