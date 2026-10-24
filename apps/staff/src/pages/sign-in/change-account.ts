import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  readCookie,
  SESSION_COOKIE,
  clearedSessionCookies,
} from '@lasvegasfortransit/platform-core/web-auth';
import { endSession } from '@lasvegasfortransit/platform-storage/auth';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import { staffAuthMode } from '@lasvegasfortransit/platform-integrations/staff-auth-config';
import {
  googleResponse,
  workspaceCookie,
  PENDING_COOKIE,
} from '@lasvegasfortransit/platform-integrations/google-sign-in';
import type { StaffEnv } from '../../lib/context';
import { EMAIL_COOKIE } from '../../lib/workspace-email';
import { SIGNED_OUT_COOKIE } from '../../lib/sso-navigation';
export const POST: APIRoute = async ({ request }) => {
  const platform = env as unknown as StaffEnv;
  if (request.headers.get('Origin') !== new URL(request.url).origin)
    return new Response(null, { status: 403 });
  const mode = staffAuthMode(platform),
    pending = readCookie(request, PENDING_COOKIE),
    session = readCookie(request, SESSION_COOKIE);
  if (!mode) return new Response(null, { status: 503 });
  if (pending) {
    const pendingHash = await hashWithSecret(
      platform.LVBT_SIGN_IN_SECRET,
      `${mode === 'google' ? 'workspace-link' : 'sso-link'}:${pending}`,
    );
    await platform.PLATFORM_DB.batch([
      platform.PLATFORM_DB.prepare(
        `DELETE FROM ${mode === 'google' ? 'workspace_pending_links' : 'staff_sso_pending'} WHERE token_hash=?`,
      ).bind(pendingHash),
      platform.PLATFORM_DB.prepare('DELETE FROM sign_in_codes WHERE workspace_link_id=?').bind(
        pendingHash,
      ),
      platform.PLATFORM_DB.prepare('DELETE FROM staff_member_handoffs WHERE pending_hash=?').bind(
        pendingHash,
      ),
    ]);
  }
  if (session) await endSession(platform, session);
  const cookies = [
    ...clearedSessionCookies(),
    ...[PENDING_COOKIE, EMAIL_COOKIE, SIGNED_OUT_COOKIE, '__Host-lvbt_member_handoff'].map((name) =>
      workspaceCookie(name, '', 0),
    ),
  ];
  return googleResponse(
    mode === 'google' ? '/sign-in/google/?next=%2F&select_account=1' : '/cdn-cgi/access/logout',
    cookies,
  );
};
