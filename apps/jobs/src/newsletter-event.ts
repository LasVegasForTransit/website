import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  receiveBeehiivEvent,
  readNewsletterBody,
  type BeehiivEventRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/beehiiv-event-receiver';

function response(status: number) {
  return new Response(status === 200 ? 'Received.' : 'Unable to receive this event.', {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
export async function handleNewsletterEventRequest(
  request: Request,
  env: BeehiivEventRuntimeEnv & { PLATFORM_DB: Db },
  now = new Date(),
): Promise<Response> {
  if (request.method !== 'POST' || request.url !== 'https://jobs.internal/newsletter/event')
    return response(404);
  if (
    request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  )
    return response(400);
  try {
    const body = await readNewsletterBody(request);
    return response(
      body
        ? await receiveBeehiivEvent(env.PLATFORM_DB, env, { body, headers: request.headers, now })
        : 413,
    );
  } catch {
    return response(503);
  }
}
