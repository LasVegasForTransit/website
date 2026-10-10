import type { ReleaseConfiguration } from '@lasvegasfortransit/web-platform/release';
import {
  validateWorkerSmokeOrigin,
  accessCredentials,
  accessFetch,
} from '@lasvegasfortransit/web-platform/release';

type ReleaseOrigins = Pick<
  ReleaseConfiguration,
  'previewUrl' | 'productionUrl' | 'previewWorker' | 'productionWorker' | 'workersDevSubdomain'
>;

function deniesAnonymousAccess(response: Response, origin: string): boolean {
  if ([401, 403].includes(response.status)) return true;
  const location = response.headers.get('location');
  if (response.status !== 302 || !location) return false;
  const challenge = new URL(location, origin);
  return (
    challenge.origin === 'https://lvbt.cloudflareaccess.com' &&
    !challenge.username &&
    !challenge.password &&
    challenge.pathname.startsWith('/cdn-cgi/access/login/')
  );
}

export function releaseBrowserCredentials(
  origin: string,
  config: ReleaseOrigins,
  env: Record<string, string | undefined> = process.env,
) {
  const url = new URL(origin);
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    return undefined;
  try {
    validateWorkerSmokeOrigin(origin, config, true);
  } catch {
    validateWorkerSmokeOrigin(origin, config, false);
    if (url.origin === new URL(config.productionUrl).origin) return undefined;
  }
  const credentials = accessCredentials(env);
  if (!credentials) throw new Error('Private release verification requires Access credentials.');
  return credentials;
}

export async function verifyReleaseAccess(
  origin: string,
  config: ReleaseOrigins,
  flags: { protected?: boolean; public?: boolean } = {},
  env: Record<string, string | undefined> = process.env,
) {
  if (flags.protected && flags.public)
    throw new Error('Choose either protected preview or public production verification.');
  validateWorkerSmokeOrigin(origin, config, flags.protected === true);
  if (flags.public && origin !== new URL(config.productionUrl).origin)
    throw new Error('Public checks require the production origin.');
  const credentials = releaseBrowserCredentials(origin, config, env);
  if (credentials) {
    for (const path of ['/', '/lvbt-release.json']) {
      const anonymous = await accessFetch(`${origin}${path}`, origin);
      if (!deniesAnonymousAccess(anonymous, origin))
        throw new Error(
          `Anonymous request reached a private release at ${path} (${anonymous.status}).`,
        );
    }
  }
  return credentials;
}
