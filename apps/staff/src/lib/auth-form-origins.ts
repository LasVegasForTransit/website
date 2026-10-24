import { staffAuthMode } from '@lasvegasfortransit/platform-integrations/staff-auth-config';
import type { StaffEnv } from './context';

// Chromium checks the full redirect chain of native forms, including a same-origin
// POST that redirects to the member site or the selected sign-in provider.
export function authFormOrigins(env: Partial<StaffEnv>, url: URL): string[] {
  if (!/^\/sign-in(?:\/|$)/.test(url.pathname)) return [];
  const member =
    env.LVBT_MEMBER_ORIGIN ??
    (url.hostname.includes('preview')
      ? 'https://preview.lasvegasfortransit.org'
      : 'https://lasvegasfortransit.org');
  const provider =
    staffAuthMode(env) === 'google'
      ? 'https://accounts.google.com'
      : env.LVBT_ACCESS_TEAM_DOMAIN
        ? `https://${env.LVBT_ACCESS_TEAM_DOMAIN}`
        : undefined;
  return provider ? [member, provider] : [member];
}
