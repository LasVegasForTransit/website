import { fileURLToPath } from 'node:url';
import { readReleaseConfiguration } from '@lasvegasfortransit/web-platform/release';

export const releaseConfiguration = await readReleaseConfiguration(
  fileURLToPath(new URL('../../../../', import.meta.url)),
);
