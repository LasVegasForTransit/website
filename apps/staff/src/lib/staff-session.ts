import { SESSION_COOKIE, readCookie } from '@lasvegasfortransit/platform-core/web-auth';
import { readWorkspaceSession } from '@lasvegasfortransit/platform-storage/workspace-link';
import { readSsoSession } from '@lasvegasfortransit/platform-storage/staff-sso';
import { staffAuthMode } from '@lasvegasfortransit/platform-integrations/staff-auth-config';
import type { AccessIdentity } from '@lasvegasfortransit/platform-integrations/access-identity';
import type { StaffEnv } from './context';

export async function readStaffSession(env: StaffEnv, request: Request, access?: AccessIdentity) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const mode = staffAuthMode(env);
  if (mode === 'google') {
    const session = await readWorkspaceSession(env, token);
    return session ? { ...session, email: session.workspaceEmail, mode } : null;
  }
  if (mode !== 'cloudflare-access' || !access) return null;
  const session = await readSsoSession(env, token, access);
  return session ? { ...session, email: access.email, mode } : null;
}
