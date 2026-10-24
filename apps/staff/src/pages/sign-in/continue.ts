import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { staffAuthMode } from '@lasvegasfortransit/platform-integrations/staff-auth-config';
import type { StaffEnv } from '../../lib/context';
import { continueSso } from '../../lib/sso-navigation';
import { messageResponse } from '../../lib/responses';
export const POST: APIRoute = async ({ request, locals }) =>
  staffAuthMode(env) === 'cloudflare-access' && locals.access
    ? continueSso(env as unknown as StaffEnv, request, locals.access)
    : messageResponse("You don't have access to this", 403);
