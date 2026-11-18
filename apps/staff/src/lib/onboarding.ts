import {
  googleResponse,
  workspaceCookie,
  PENDING_COOKIE,
} from '@lasvegasfortransit/platform-integrations/google-sign-in';
import { sessionCookies } from '@lasvegasfortransit/platform-core/web-auth';
import type { WorkspaceCompletion } from '@lasvegasfortransit/platform-storage/workspace-link';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { EMAIL_COOKIE } from './workspace-email';
/**
 * The welcome screen confirms a person's first Staff Portal sign-in. Signing out deletes only that
 * browser's session and expired sessions are kept, so any earlier staff session means this person
 * has already seen it and can go straight to their destination.
 */
export async function hasEarlierStaffSession(db: Db, personId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT count(*) AS n FROM sessions WHERE person_id=? AND type='staff'")
    .bind(personId)
    .first<{ n: number }>();
  return (row?.n ?? 0) > 1;
}
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
