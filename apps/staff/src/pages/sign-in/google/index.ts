import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { startGoogleSignIn } from '@lasvegasfortransit/platform-integrations/google-sign-in';
import type { StaffEnv } from '../../../lib/context';
export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  if (!url.searchParams.has('next')) url.searchParams.set('next', '/');
  return await startGoogleSignIn(env as unknown as StaffEnv, new Request(url, request));
};
