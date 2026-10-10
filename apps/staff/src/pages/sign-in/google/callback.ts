import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { googleCallback } from '@lasvegasfortransit/platform-integrations/google-sign-in';
import type { StaffEnv } from '../../../lib/context';
export const GET: APIRoute = async ({ request }) =>
  await googleCallback(env as unknown as StaffEnv, request);
