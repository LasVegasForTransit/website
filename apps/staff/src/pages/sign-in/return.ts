import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { StaffEnv } from '../../lib/context';
import { staffSignInReturn } from '../../lib/sign-in-return';
export const GET: APIRoute = async ({ request, locals }) =>
  staffSignInReturn(env as unknown as StaffEnv, request, locals.access);
