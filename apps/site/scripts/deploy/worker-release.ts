import { runWorkerRelease } from '@lasvegasfortransit/web-platform/release';
import { releaseConfiguration } from './release-config';

await runWorkerRelease(releaseConfiguration);
