import type { APIRoute } from 'astro';
import { welcomeAction } from '../../../lib/welcome';
import { messageResponse } from '../../../lib/responses';
export const POST: APIRoute = async ({ request, locals, params }) =>
  locals.staff
    ? await welcomeAction(request, locals.staff, params.id ?? '', 'release')
    : messageResponse("You don't have access to this", 403);
