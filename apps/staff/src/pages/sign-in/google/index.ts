import { staffAuthMode } from '@lasvegasfortransit/platform-integrations/staff-auth-config';
import { messageResponse } from '../../../lib/responses';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { startGoogleSignIn } from '@lasvegasfortransit/platform-integrations/google-sign-in';
import type { StaffEnv } from '../../../lib/context';
export const GET: APIRoute = async ({ request }) => {
  if (staffAuthMode(env) !== 'google') return messageResponse("You don't have access to this", 403);
  const url = new URL(request.url);
  if (!url.searchParams.has('next')) url.searchParams.set('next', '/');
  return await startGoogleSignIn(env as unknown as StaffEnv, new Request(url, request));
};
