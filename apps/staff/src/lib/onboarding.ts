import {
  googleResponse,
  workspaceCookie,
  PENDING_COOKIE,
} from '@lasvegasfortransit/platform-integrations/google-sign-in';
import { sessionCookies } from '@lasvegasfortransit/platform-core/web-auth';
import type { WorkspaceCompletion } from '@lasvegasfortransit/platform-storage/workspace-link';
import { EMAIL_COOKIE } from './workspace-email';
export function staffWelcomePath(next: string) {
  return `/sign-in/ready/?next=${encodeURIComponent(next)}`;
}
export function completedStaffSetup(result: Extract<WorkspaceCompletion, { kind: 'ok' }>) {
  return googleResponse(staffWelcomePath(result.returnTo), [
    workspaceCookie(PENDING_COOKIE, '', 0),
    workspaceCookie(EMAIL_COOKIE, '', 0),
    workspaceCookie('__Host-lvbt_member_handoff', '', 0),
    ...sessionCookies(result.session.token, result.session.expiresAt),
  ]);
}
