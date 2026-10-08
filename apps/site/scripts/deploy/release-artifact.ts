import { packageRelease as sharedPackageRelease } from '@lasvegasfortransit/web-platform/release';
import { releaseConfiguration } from './release-config';

export { verifyRelease } from '@lasvegasfortransit/web-platform/release';
export type { WebsiteRelease } from '@lasvegasfortransit/web-platform/release';
export function packageRelease(...args: Parameters<typeof sharedPackageRelease>) {
  return sharedPackageRelease(args[0], args[1], args[2], releaseConfiguration.artifactAcceptance);
}
