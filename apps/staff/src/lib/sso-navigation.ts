import { signToken, verifyToken, hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import { readCookie, safeNext } from '@lasvegasfortransit/platform-core/web-auth';
import {
  googleResponse,
  workspaceCookie,
} from '@lasvegasfortransit/platform-integrations/google-sign-in';
import { staffOriginAllowed } from '@lasvegasfortransit/platform-integrations/staff-auth-config';
import type { AccessIdentity } from '@lasvegasfortransit/platform-integrations/access-identity';
import type { StaffEnv } from './context';
type LogoutEnv = Pick<
  StaffEnv,
  | 'LVBT_SIGN_IN_SECRET'
  | 'LVBT_STAFF_ORIGIN'
  | 'LVBT_STAFF_PREVIEW_ORIGINS'
  | 'LVBT_GOOGLE_PREVIEW_ORIGINS'
>;
export const SIGNED_OUT_COOKIE = '__Host-lvbt_staff_signed_out';
async function binding(env: LogoutEnv, principal: AccessIdentity) {
  return hashWithSecret(
    env.LVBT_SIGN_IN_SECRET,
    JSON.stringify([principal.issuer, principal.subject]),
  );
}
export async function signedOutCookie(env: LogoutEnv, principal: AccessIdentity) {
  const seconds = 30 * 24 * 60 * 60;
  const token = await signToken(env.LVBT_SIGN_IN_SECRET, {
    purpose: 'staff_signed_out',
    subject: await binding(env, principal),
    expiresAt: Date.now() + seconds * 1000,
  });
  return workspaceCookie(SIGNED_OUT_COOKIE, token, seconds);
}
export async function isSignedOut(env: LogoutEnv, request: Request, principal: AccessIdentity) {
  const cookie = readCookie(request, SIGNED_OUT_COOKIE);
  if (!cookie) return false;
  const marker = await verifyToken(env.LVBT_SIGN_IN_SECRET, cookie, 'staff_signed_out');
  return marker?.subject === (await binding(env, principal));
}
export async function continueSso(env: LogoutEnv, request: Request, principal: AccessIdentity) {
  const origin = new URL(request.url).origin;
  if (
    request.method !== 'POST' ||
    request.headers.get('Origin') !== origin ||
    !staffOriginAllowed(env, origin) ||
    !(await isSignedOut(env, request, principal))
  )
    return new Response(null, { status: 403 });
  const form = await request.formData();
  const requestedNext = form.get('next');
  const next = safeNext(typeof requestedNext === 'string' ? requestedNext : '/');
  return googleResponse(`/sign-in/?next=${encodeURIComponent(next)}`, [
    workspaceCookie(SIGNED_OUT_COOKIE, '', 0),
  ]);
}
