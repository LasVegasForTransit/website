import { readNewsletterBody } from '@lasvegasfortransit/platform-integrations/beehiiv-event-receiver';

function response(status: number): Response {
  return new Response(status === 200 ? 'Received.' : 'Unable to receive this event.', {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
async function deliver(request: Request, jobs: Pick<Fetcher, 'fetch'>): Promise<Response> {
  const body = await readNewsletterBody(request);
  if (!body) return response(413);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const name of ['svix-id', 'svix-timestamp', 'svix-signature']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const received = await jobs.fetch(
    new Request('https://jobs.internal/newsletter/event', {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(8000),
      redirect: 'manual',
    }),
  );
  await received.body?.cancel();
  return response([200, 400, 401, 409, 413, 503].includes(received.status) ? received.status : 503);
}
/** Forward exact bytes through the private jobs binding; signing keys stay on jobs. */
export async function forwardBeehiivEvent(
  request: Request,
  jobs?: Pick<Fetcher, 'fetch'>,
): Promise<Response> {
  if (request.method !== 'POST') return response(405);
  if (
    request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  )
    return response(400);
  if (!jobs) return response(503);
  try {
    return await deliver(request, jobs);
  } catch {
    return response(503);
  }
}
export const onRequest: PagesFunction<Pick<Env, 'LVBT_DISCORD_JOBS'>> = (context) =>
  forwardBeehiivEvent(context.request, context.env.LVBT_DISCORD_JOBS);
