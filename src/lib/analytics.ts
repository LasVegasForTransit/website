import type { AstroIntegration } from 'astro';
import { lvbtAnalytics } from '@lasvegasfortransit/analytics/astro';

export function analyticsIntegrations(requireAnalytics: boolean): AstroIntegration[] {
  return requireAnalytics ? [lvbtAnalytics({ site: 'lasvegasfortransit.org' })] : [];
}
