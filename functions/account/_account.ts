/// <reference types="@cloudflare/workers-types" />

// Helpers shared by the account handlers: who is signed in, serving a built
// account page with the header in its signed-in state, and the one-time
// notice after a change. Underscore-prefixed so Pages does not route it.

import type { AccountEnv } from '../../platform/account';
import {
  clearedNoticeCookie,
  fromThisSite,
  NOTICE_COOKIE,
  noticeCookie,
  readCookie,
  requireMember,
  signInEnv,
  signInRedirect,
  type CurrentPerson,
} from '../../platform/sign-in';
import { builtPage, finish, redirect } from '../join/_page';
import { field, formOf, refused, type SignInPagesEnv } from '../sign-in/_shared';

export { field, formOf };

export interface Signed {
  env: AccountEnv;
  person: CurrentPerson;
}

export function accountEnv(env: SignInPagesEnv): AccountEnv | null {
  const base = signInEnv(env);
  if (!base) return null;
  return {
    ...base,
    LVBT_BEEHIIV_API_KEY: env.LVBT_BEEHIIV_API_KEY,
    LVBT_BEEHIIV_PUBLICATION_ID: env.LVBT_BEEHIIV_PUBLICATION_ID,
  };
}

/** The signed-in member, or the response to send instead (sign in, or refuse). */
export async function signedIn(env: SignInPagesEnv, request: Request): Promise<Signed | Response> {
  if (request.method === 'POST' && !fromThisSite(request)) return refused();
  const platform = accountEnv(env);
  // Without the database or sign-in secret nobody can be signed in, so the
  // visitor is sent to sign in, where the form says signing in isn't working.
  if (!platform) return signInRedirect(request, false);
  const member = await requireMember(platform, request);
  if (member instanceof Response) return member;
  return { env: platform, person: member.person };
}

const HIDE_SIGNED_OUT: HTMLRewriterElementContentHandlers = {
  element(element) {
    if (element.getAttribute('data-auth') === 'signed-in') element.removeAttribute('hidden');
    else element.setAttribute('hidden', '');
  },
};

/**
 * Serve a built account page, transformed by `fill`, with the header showing
 * "Your account" and "Sign out" even without JavaScript. Never cached.
 */
export interface PageOptions {
  fill?: (rewriter: HTMLRewriter) => HTMLRewriter;
  status?: number;
  headers?: HeadersInit;
}

export async function accountPage(
  env: SignInPagesEnv,
  request: Request,
  path: string,
  options: PageOptions = {},
): Promise<Response> {
  const { fill = (rewriter: HTMLRewriter) => rewriter, status = 200, headers = {} } = options;
  const page = await builtPage(env, request, path);
  const rewriter = fill(new HTMLRewriter().on('[data-auth]', HIDE_SIGNED_OUT));
  const response = finish(rewriter.transform(page), status, headers);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export type NoticeId =
  'name' | 'phone' | 'email' | 'area' | 'area_placed' | 'left' | 'rejoined' | 'unavailable';

/** Back to the account page, which shows the notice once (functions/account/index.ts). */
export function backToAccount(notice: NoticeId): Response {
  return redirect('/account/', { 'Set-Cookie': noticeCookie(notice) });
}

/** The notice waiting for this page, if any, and the cookie that clears it. */
export function takeNotice(request: Request): { key: string | null; clear: HeadersInit } {
  const key = readCookie(request, NOTICE_COOKIE);
  return { key, clear: key ? { 'Set-Cookie': clearedNoticeCookie() } : {} };
}

export function callerAddress(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}
