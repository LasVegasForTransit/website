import { verifyWorkspaceWorkload } from '@lasvegasfortransit/platform-integrations/workspace-connector-auth';
import { validateConfig, type ConnectorConfig } from './config';
import { ManagedGoogleCredentials } from './credentials';
import { Directory } from './directory';
import { Site } from './site';
import { GroupExecutor } from './groups';
import { ConnectorFailure, readJson } from './http';
import { EVENTS, recover, renewChannels, tokenHash } from './maintenance';
interface Transports {
  fetch?: typeof fetch;
  now?: () => Date;
}
function response(status: number) {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
}
async function proof(request: Request, site: Site) {
  const id = request.headers.get('X-Goog-Channel-ID') ?? '',
    token = request.headers.get('X-Goog-Channel-Token') ?? '',
    resourceId = request.headers.get('X-Goog-Resource-ID') ?? '';
  const event = id.split('.')[0];
  if (
    !EVENTS.some((e) => e === event) ||
    id.length > 128 ||
    !token ||
    token.length > 256 ||
    !resourceId ||
    resourceId.length > 256
  )
    return null;
  const proof = await site.action('channelValidate', {
    id,
    resourceId,
    event,
    tokenHash: tokenHash(token),
  });
  return proof.valid === true ? proof : null;
}
function permitted(config: ConnectorConfig, userId: string) {
  return config.environment !== 'preview' || config.previewUserIds?.includes(userId) === true;
}
async function notify(
  request: Request,
  context: { site: Site; directory: Directory; groups: GroupExecutor; config: ConnectorConfig },
) {
  const channel = await proof(request, context.site);
  if (!channel) return response(401);
  if (typeof channel.retryAfterMs === 'number' && channel.retryAfterMs > 0) return response(204);
  const state = request.headers.get('X-Goog-Resource-State');
  if (state === 'sync') return response(204);
  if (
    !EVENTS.some((e) => e === state) ||
    !request.headers.get('X-Goog-Channel-ID')?.startsWith(`${state}.`)
  )
    return response(400);
  const body = await readJson(new Response(request.body), 65536);
  if (typeof body.id !== 'string') return response(400);
  if (!permitted(context.config, body.id)) return response(204);
  // A deletion hint is not deletion proof. The deleted-user scan confirms tombstones.
  let account;
  try {
    account = await context.directory.account(body.id);
  } catch (error) {
    if (error instanceof ConnectorFailure && error.kind === 'not_found') return response(204);
    throw error;
  }
  const result = await context.site.action('enroll', { account });
  await context.groups.run(typeof result.personId === 'string' ? result.personId : undefined);
  return response(204);
}
export function createWorkspaceConnector(input: ConnectorConfig, transports: Transports = {}) {
  const config = validateConfig(input),
    fetcher = transports.fetch ?? fetch,
    now = transports.now ?? (() => new Date());
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (
        url.origin !== config.origin ||
        !['/run', '/notifications'].includes(url.pathname) ||
        url.search
      )
        return response(404);
      if (request.method !== 'POST') return response(405);
      if (
        url.pathname === '/run' &&
        !(await verifyWorkspaceWorkload(
          request,
          { subject: config.schedulerSubject, audience: config.origin },
          { fetch: fetcher, now: now() },
        ))
      )
        return response(401);
      if (url.pathname === '/notifications' && !request.headers.get('X-Goog-Channel-Token'))
        return response(401);
      const deadline = now().getTime() + 45000,
        controller = AbortSignal.timeout(45000);
      const boundedFetch: typeof fetch = (resource, init) =>
        fetcher(resource, {
          ...init,
          redirect: 'manual',
          signal: AbortSignal.any([controller, ...(init?.signal ? [init.signal] : [])]),
        });
      const credentials = new ManagedGoogleCredentials(config, { fetch: boundedFetch, now });
      const site = new Site(config.siteAudience, credentials, boundedFetch);
      const directory = new Directory(config, credentials, { fetch: boundedFetch, now, site });
      const groups = new GroupExecutor(config, credentials, {
        fetch: boundedFetch,
        now,
        site,
        deadline,
      });
      try {
        if (url.pathname === '/notifications')
          return await notify(request, { site, directory, groups, config });
        const maintenance = await site.action('maintenance');
        await renewChannels(config, directory, site, { now: now(), events: maintenance.events });
        await recover(directory, site, { now, deadline, config }, maintenance.scan);
        if (maintenance.groupsDue === true) await groups.run();
        return response(200);
      } catch {
        return response(503);
      }
    },
  };
}
