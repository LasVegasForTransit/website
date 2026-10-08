import type { ReleaseConfiguration } from '@lasvegasfortransit/web-platform/release';
import {
  validateWorkerSmokeOrigin,
  accessCredentials,
} from '@lasvegasfortransit/web-platform/release';

export function releaseBrowserCredentials(
  origin: string,
  config: Pick<
    ReleaseConfiguration,
    'previewUrl' | 'productionUrl' | 'previewWorker' | 'productionWorker' | 'workersDevSubdomain'
  >,
  env: Record<string, string | undefined> = process.env,
) {
  const url = new URL(origin);
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    return undefined;
  try {
    validateWorkerSmokeOrigin(origin, config, true);
  } catch {
    validateWorkerSmokeOrigin(origin, config, false);
    return undefined;
  }
  return accessCredentials(env);
}
