import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { StaffEnv } from '../../lib/context';
import { staffSignInReturn } from '../../lib/sign-in-return';
import { messageResponse } from '../../lib/responses';
export const GET: APIRoute = async ({ request, locals }) =>
  locals.access
    ? await staffSignInReturn(env as unknown as StaffEnv, request, locals.access)
    : messageResponse("You don't have access to this", 403);
