import { runPromote } from '@lasvegasfortransit/web-platform/release';
import { releaseConfiguration } from './release-config';

await runPromote(releaseConfiguration);
