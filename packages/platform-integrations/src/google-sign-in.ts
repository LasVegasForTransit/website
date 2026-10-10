import { WORKSPACE_DOMAIN } from '@lasvegasfortransit/platform-core/workspace-identity';
import {
  exchangeGoogleCode,
  verifyGoogleIdToken,
} from '@lasvegasfortransit/platform-integrations/google-identity';
import {
  beginWorkspaceSignIn,
  consumeWorkspaceState,
  consumeWorkspaceTicket,
  createWorkspaceSession,
  issueWorkspaceTicket,
  WorkspaceLinkService,
} from '@lasvegasfortransit/platform-storage/workspace-link';
import type { AuthEnv } from '@lasvegasfortransit/platform-storage/auth';
import { readCookie, safeNext, sessionCookies } from '@lasvegasfortransit/platform-core/web-auth';

export const STATE_COOKIE = '__Host-lvbt_workspace_state';
export const PENDING_COOKIE = '__Host-lvbt_workspace_pending';
export interface GoogleSignInEnv extends AuthEnv {
  LVBT_GOOGLE_OAUTH_CLIENT_ID?: string;
  LVBT_GOOGLE_OAUTH_CLIENT_SECRET?: string;
  /** Exact approved deployment origins, provisioned by the maintainer. */
  LVBT_GOOGLE_PREVIEW_ORIGINS?: string;
}
const PUBLIC_ORIGIN = 'https://lasvegasfortransit.org';
const STAFF_ORIGIN = 'https://staff.lasvegasfortransit.org';
const PREVIEW_ORIGIN = 'https://preview.lasvegasfortransit.org';
const STAFF_PREVIEW_ORIGIN = 'https://staff-preview.lasvegasfortransit.org';

export function googleOriginAllowed(env: GoogleSignInEnv, origin: string): boolean {
  if ([PUBLIC_ORIGIN, STAFF_ORIGIN, PREVIEW_ORIGIN, STAFF_PREVIEW_ORIGIN].includes(origin))
    return true;
  try {
    const origins: unknown = JSON.parse(env.LVBT_GOOGLE_PREVIEW_ORIGINS ?? '[]');
    return (
      Array.isArray(origins) &&
      origins.includes(origin) &&
      /^https:\/\/[a-z0-9-]*lvbt-(website|staff)-preview\.[a-z0-9-]+\.workers\.dev$/.test(origin)
    );
  } catch {
    return false;
  }
}

export function workspaceCookie(name: string, token: string, seconds: number): string {
  return `${name}=${token}; Max-Age=${seconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function googleResponse(location: string, cookies: string[] = []): Response {
  const headers = new Headers({
    Location: location,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

function unavailable(status: number): Response {
  return new Response('Google sign-in is unavailable. Return to /sign-in/ to use an email code.', {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export async function startGoogleSignIn(env: GoogleSignInEnv, request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!googleOriginAllowed(env, url.origin)) return unavailable(403);
  if (!env.LVBT_GOOGLE_OAUTH_CLIENT_ID || !env.LVBT_GOOGLE_OAUTH_CLIENT_SECRET)
    return unavailable(503);
  const callbackOrigin =
    url.origin === PUBLIC_ORIGIN || url.origin === STAFF_ORIGIN ? url.origin : PREVIEW_ORIGIN;
  const started = await beginWorkspaceSignIn(env.PLATFORM_DB, {
    returnTo: safeNext(url.searchParams.get('next')),
    callbackUrl: `${callbackOrigin}/sign-in/google/callback`,
    origin: url.origin,
  });
  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.search = new URLSearchParams({
    client_id: env.LVBT_GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: started.callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    hd: WORKSPACE_DOMAIN,
    state: started.state,
    nonce: started.nonce,
    code_challenge: started.challenge,
    code_challenge_method: 'S256',
  }).toString();
  return googleResponse(google.href, [workspaceCookie(STATE_COOKIE, started.state, 600)]);
}

function failed(): Response {
  return googleResponse('/sign-in/?google_error=1', [workspaceCookie(STATE_COOKIE, '', 0)]);
}

async function finishGoogleSignIn(env: GoogleSignInEnv, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const state = readCookie(request, STATE_COOKIE);
  if (!state || state !== url.searchParams.get('state')) return failed();
  const ticket = await consumeWorkspaceTicket(env.PLATFORM_DB, {
    ticket: url.searchParams.get('ticket') ?? '',
    state,
    origin: url.origin,
  });
  if (!ticket) return failed();
  const session = await createWorkspaceSession(env, ticket.workspace);
  const clear = workspaceCookie(STATE_COOKIE, '', 0);
  if (session)
    return googleResponse(ticket.returnTo, [
      clear,
      ...sessionCookies(session.token, session.expiresAt),
    ]);
  const pending = await new WorkspaceLinkService(env).begin(ticket.workspace, {
    returnTo: ticket.returnTo,
  });
  return googleResponse('/sign-in/link-account/', [
    clear,
    workspaceCookie(PENDING_COOKIE, pending, 900),
  ]);
}

export async function googleCallback(
  env: GoogleSignInEnv,
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  if (!googleOriginAllowed(env, url.origin)) return unavailable(403);
  if (url.searchParams.get('cancelled') === '1')
    return googleResponse('/sign-in/?google_error=1', [workspaceCookie(STATE_COOKIE, '', 0)]);
  if (url.searchParams.has('ticket')) return await finishGoogleSignIn(env, request);
  if (!env.LVBT_GOOGLE_OAUTH_CLIENT_ID || !env.LVBT_GOOGLE_OAUTH_CLIENT_SECRET)
    return unavailable(503);
  const state = url.searchParams.get('state') ?? '';
  const saved = await consumeWorkspaceState(env.PLATFORM_DB, state);
  if (
    saved?.callbackUrl !== `${url.origin}/sign-in/google/callback` ||
    !googleOriginAllowed(env, saved.origin)
  )
    return failed();
  if (url.searchParams.has('error')) {
    const cancellation = new URL('/sign-in/google/callback', saved.origin);
    cancellation.searchParams.set('cancelled', '1');
    return googleResponse(cancellation.href);
  }
  try {
    const token = await exchangeGoogleCode(
      {
        code: url.searchParams.get('code') ?? '',
        verifier: saved.verifier,
        callbackUrl: saved.callbackUrl,
        clientId: env.LVBT_GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: env.LVBT_GOOGLE_OAUTH_CLIENT_SECRET,
      },
      fetcher,
    );
    const workspace = await verifyGoogleIdToken(token, {
      clientId: env.LVBT_GOOGLE_OAUTH_CLIENT_ID,
      nonce: saved.nonce,
      fetch: fetcher,
    });
    const ticket = await issueWorkspaceTicket(env.PLATFORM_DB, {
      workspace,
      state,
      origin: saved.origin,
      returnTo: saved.returnTo,
    });
    const destination = new URL('/sign-in/google/callback', saved.origin);
    destination.search = new URLSearchParams({ ticket, state }).toString();
    return googleResponse(destination.href);
  } catch {
    // Do not log authorization codes, provider responses, tokens or personal data.
    return googleResponse(`${saved.origin}/sign-in/?google_error=1`);
  }
}
