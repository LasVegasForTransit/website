import type { APIRoute } from 'astro';
import { applicationAction } from '../../../lib/applications';
import { messageResponse } from '../../../lib/responses';
export const POST: APIRoute = async ({ request, locals, params }) =>
  locals.staff
    ? await applicationAction(request, locals.staff, params.id ?? '', 'accept')
    : messageResponse("You don't have access to this", 403);
