import { WorkspaceLinkService } from '@lasvegasfortransit/platform-storage/workspace-link';
import { SsoLinkService } from '@lasvegasfortransit/platform-storage/staff-sso';
import { staffAuthMode } from '@lasvegasfortransit/platform-integrations/staff-auth-config';
import type { StaffEnv } from './context';
export function linkService(env: StaffEnv) {
  return staffAuthMode(env) === 'cloudflare-access'
    ? new SsoLinkService(env)
    : new WorkspaceLinkService(env);
}
