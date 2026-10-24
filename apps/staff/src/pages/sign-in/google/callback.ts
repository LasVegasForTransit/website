import { staffAuthMode } from '@lasvegasfortransit/platform-integrations/staff-auth-config';
import { messageResponse } from '../../../lib/responses';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { googleCallback } from '@lasvegasfortransit/platform-integrations/google-sign-in';
import type { StaffEnv } from '../../../lib/context';
import { throughStaffReturn } from '../../../lib/sign-in-return';
export const GET: APIRoute = async ({ request }) =>
  staffAuthMode(env) !== 'google'
    ? messageResponse("You don't have access to this", 403)
    : throughStaffReturn(await googleCallback(env as unknown as StaffEnv, request));
