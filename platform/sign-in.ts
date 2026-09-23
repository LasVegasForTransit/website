// Member sign-in as the site uses it: asking for a code, checking it, the
// cookies that keep a browser signed in, and finding out who is signed in.
// The storage underneath is platform/auth.ts.

import {
  CODE_MINUTES,
  checkCode,
  createSession,
  endSession,
  linkIsLive,
  mayTellStranger,
  readSession,
  requestCode,
  useLink,
  type AuthEnv,
  type CheckOutcome,
  type SessionPerson,
} from './auth';
import { ulid } from './core/ids';
import { signToken, verifyToken } from './core/signing';
import { escapeHtml, sendEmail, type Email, type SendResult } from './integrations/email';
import { formatTime, t } from './messages';
import type { Db } from './storage/db';
import { normalizeEmail } from './storage/person-service';

export const SITE_ORIGIN = 'https://lasvegasfortransit.org';
export const SESSION_COOKIE = '__Host-lvbt_session';
export const SIGNED_IN_COOKIE = 'lvbt_signed_in';
export const STEP_COOKIE = 'lvbt_sign_in';
export const ACCOUNT_PATH = '/account/';

export interface SignInEnv extends AuthEnv {
  LVBT_RESEND_API_KEY?: string;
  /**
   * Local development only: with "1" and no Resend key, codes are printed to
   * the console instead of emailed. Never set in production.
   */
  LVBT_DEV_LOG_CODES?: string;
}

/** The environment, or null when the database or sign-in secret is missing. */
export function signInEnv(env: {
  PLATFORM_DB?: unknown;
  LVBT_SIGN_IN_SECRET?: string;
  LVBT_RESEND_API_KEY?: string;
  LVBT_DEV_LOG_CODES?: string;
}): SignInEnv | null {
  if (!env.PLATFORM_DB || !env.LVBT_SIGN_IN_SECRET) {
    console.error('sign-in: PLATFORM_DB binding or LVBT_SIGN_IN_SECRET is missing');
    return null;
  }
  return {
    PLATFORM_DB: env.PLATFORM_DB as Db,
    LVBT_SIGN_IN_SECRET: env.LVBT_SIGN_IN_SECRET,
    LVBT_RESEND_API_KEY: env.LVBT_RESEND_API_KEY,
    LVBT_DEV_LOG_CODES: env.LVBT_DEV_LOG_CODES,
  };
}

// --- Cookies -------------------------------------------------------------

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=') || null;
  }
  return null;
}

/** The session cookie and the non-secret "signed in" marker for public pages. */
export function sessionCookies(token: string, expiresAt: Date): string[] {
  const expires = expiresAt.toUTCString();
  return [
    `${SESSION_COOKIE}=${token}; Expires=${expires}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    `${SIGNED_IN_COOKIE}=1; Expires=${expires}; Path=/; Secure; SameSite=Lax`,
  ];
}

export function clearedSessionCookies(): string[] {
  return [
    `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
    `${SIGNED_IN_COOKIE}=; Max-Age=0; Path=/; Secure; SameSite=Lax`,
  ];
}

// The short-lived, signed record of the code this browser asked for: which
// email, which request, and where to go afterwards. It lasts as long as the
// code does.
export interface SignInStep {
  email: string;
  requestId: string;
  next: string;
}

export async function stepCookie(secret: string, step: SignInStep): Promise<string> {
  const token = await signToken(secret, {
    purpose: 'sign_in_step',
    subject: step.requestId,
    expiresAt: Date.now() + CODE_MINUTES * 60 * 1000,
    data: { email: step.email, next: step.next },
  });
  return `${STEP_COOKIE}=${token}; Path=/sign-in; Max-Age=${CODE_MINUTES * 60}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearedStepCookie(): string {
  return `${STEP_COOKIE}=; Max-Age=0; Path=/sign-in; HttpOnly; Secure; SameSite=Lax`;
}

export async function readStep(secret: string, request: Request): Promise<SignInStep | null> {
  const value = readCookie(request, STEP_COOKIE);
  if (!value) return null;
  const payload = await verifyToken(secret, value, 'sign_in_step');
  if (!payload?.data?.email) return null;
  return {
    email: payload.data.email,
    requestId: payload.subject,
    next: safeNext(payload.data.next),
  };
}

// A one-time notice for the next page rendered on request, such as
// "You're signed in." after the redirect. Holds only a message key.
export const NOTICE_COOKIE = 'lvbt_notice';

export function noticeCookie(key: string): string {
  return `${NOTICE_COOKIE}=${key}; Max-Age=120; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearedNoticeCookie(): string {
  return `${NOTICE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

// --- Checks --------------------------------------------------------------

/**
 * Where to go after signing in: a path on this site, never another site.
 * Anything else becomes the account page.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next?.startsWith('/') || next.startsWith('//') || next.includes('\\')) return ACCOUNT_PATH;
  try {
    const url = new URL(next, SITE_ORIGIN);
    if (url.origin !== SITE_ORIGIN) return ACCOUNT_PATH;
    return `${url.pathname}${url.search}`;
  } catch {
    return ACCOUNT_PATH;
  }
}

/**
 * Forms that change sign-in state accept POSTs only from this site. Browsers
 * send Origin with every form POST; a request that has neither Origin nor
 * Referer is let through, because the SameSite cookie still protects it.
 */
export function fromThisSite(request: Request): boolean {
  const own = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin) return origin === own;
  const referer = request.headers.get('Referer');
  if (referer) {
    try {
      return new URL(referer).origin === own;
    } catch {
      return false;
    }
  }
  return true;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

// --- Asking for a code ---------------------------------------------------

export type AskOutcome =
  | { kind: 'sent'; step: SignInStep; send?: () => Promise<SendResult> }
  | { kind: 'invalid' }
  | { kind: 'rate_limited'; retryAfter: string };

/**
 * Ask for a sign-in code. The outcome looks the same whether or not the
 * email belongs to anyone; `send`, when present, emails the code and should
 * run after the response (so the timing doesn't give the answer away either).
 */
export async function askForCode(
  env: SignInEnv,
  input: { email: string; next?: string | null; callerAddress: string; origin?: string },
  fetcher: typeof fetch = fetch,
): Promise<AskOutcome> {
  const email = normalizeEmail(input.email);
  if (!validEmail(email)) return { kind: 'invalid' };
  const outcome = await requestCode(env, {
    email,
    purpose: 'sign_in',
    callerAddress: input.callerAddress,
  });
  if (outcome.kind === 'rate_limited') {
    return { kind: 'rate_limited', retryAfter: formatTime(outcome.retryAfter) };
  }
  const step: SignInStep = { email, requestId: ulid(), next: safeNext(input.next) };
  const origin = input.origin ?? SITE_ORIGIN;
  // Someone who isn't a member hears about it only in their own inbox: the
  // page they see is the same either way.
  if (outcome.kind === 'no_person') {
    if (!(await mayTellStranger(env, email))) return { kind: 'sent', step };
    const joinLink = `${origin}/join/member/`;
    return {
      kind: 'sent',
      step,
      send: () => sendCodeEmail(env, notMemberEmail(email, joinLink), fetcher),
    };
  }
  const link = `${origin}/sign-in/link/${outcome.issued.linkToken}${
    step.next === ACCOUNT_PATH ? '' : `?next=${encodeURIComponent(step.next)}`
  }`;
  return {
    kind: 'sent',
    step,
    send: () => sendCodeEmail(env, signInEmail(email, outcome.issued.code, link), fetcher),
  };
}

/**
 * Send an email that carries a code. In local development, with
 * LVBT_DEV_LOG_CODES=1 and no Resend key, the subject (which holds the code)
 * is printed to the console instead, so contributors can sign in.
 */
export function sendCodeEmail(
  env: Pick<SignInEnv, 'LVBT_RESEND_API_KEY' | 'LVBT_DEV_LOG_CODES'>,
  email: Email,
  fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  if (!env.LVBT_RESEND_API_KEY && env.LVBT_DEV_LOG_CODES === '1') {
    const link = /https?:\/\/\S+\/sign-in\/link\/\S+/.exec(email.text)?.[0];
    console.log(`email (development) to ${email.to}: ${email.subject}${link ? ` ${link}` : ''}`);
  }
  return sendEmail({ resendApiKey: env.LVBT_RESEND_API_KEY }, email, fetcher);
}

export function signInEmail(to: string, code: string, link: string): Email {
  const body = t('email.signInBody', { code });
  const button = t('email.signInButton');
  const ignore = t('email.signInIgnore');
  const signOff = t('email.signOff');
  return {
    to,
    subject: t('email.signInSubject', { code }),
    template: 'sign_in_code',
    text: `${body}\n\n${button}: ${link}\n\n${ignore}\n\n${signOff}`,
    html:
      `<p style="font-size:18px">${escapeHtml(body)}</p>` +
      `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;font-weight:bold;text-decoration:none">${escapeHtml(button)}</a></p>` +
      `<p>${escapeHtml(ignore)}</p><p>${escapeHtml(signOff)}</p>`,
  };
}

export function notMemberEmail(to: string, joinLink: string): Email {
  const body = t('email.notMemberBody');
  const button = t('email.notMemberButton');
  const ignore = t('email.notMemberIgnore');
  const signOff = t('email.signOff');
  return {
    to,
    subject: t('email.notMemberSubject'),
    template: 'sign_in_not_member',
    text: `${body}\n\n${button}: ${joinLink}\n\n${ignore}\n\n${signOff}`,
    html:
      `<p style="font-size:18px">${escapeHtml(body)}</p>` +
      `<p><a href="${escapeHtml(joinLink)}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;font-weight:bold;text-decoration:none">${escapeHtml(button)}</a></p>` +
      `<p>${escapeHtml(ignore)}</p><p>${escapeHtml(signOff)}</p>`,
  };
}

// --- Signing in ----------------------------------------------------------

export type SignInOutcome =
  { kind: 'signed_in'; cookies: string[] } | Exclude<CheckOutcome, { kind: 'ok' }>;

export async function signInWithCode(
  env: SignInEnv,
  step: SignInStep,
  code: string,
): Promise<SignInOutcome> {
  const outcome = await checkCode(env, {
    email: step.email,
    code,
    purpose: 'sign_in',
    requestId: step.requestId,
  });
  if (outcome.kind !== 'ok') return outcome;
  const session = await createSession(env, outcome.personId, 'member');
  return { kind: 'signed_in', cookies: sessionCookies(session.token, session.expiresAt) };
}

export async function signInWithLink(
  env: SignInEnv,
  token: string,
): Promise<{ kind: 'signed_in'; cookies: string[] } | { kind: 'expired' }> {
  const outcome = await useLink(env, token, 'sign_in');
  if (outcome.kind !== 'ok') return outcome;
  const session = await createSession(env, outcome.personId, 'member');
  return { kind: 'signed_in', cookies: sessionCookies(session.token, session.expiresAt) };
}

export function linkReady(env: SignInEnv, token: string): Promise<boolean> {
  return linkIsLive(env, token, 'sign_in');
}

export async function signOut(env: SignInEnv, request: Request): Promise<string[]> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await endSession(env, token);
  return clearedSessionCookies();
}

// --- Who is signed in ----------------------------------------------------

export type CurrentPerson = SessionPerson;

export type CurrentMember =
  | { signedIn: false; clearCookies: boolean }
  | { signedIn: true; person: CurrentPerson; sessionType: 'member' | 'staff' };

// One lookup per request, however many times a page asks.
const answers = new WeakMap<Request, Promise<CurrentMember>>();

async function lookUp(env: SignInEnv, request: Request): Promise<CurrentMember> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token)
    return { signedIn: false, clearCookies: readCookie(request, SIGNED_IN_COOKIE) !== null };
  const session = await readSession(env, token);
  if (!session) return { signedIn: false, clearCookies: true };
  return { signedIn: true, person: session.person, sessionType: session.type };
}

/**
 * The signed-in person, or "signed out". Never returns consent records,
 * engagement history or identities; pages that need more ask the person
 * service once this confirms who is signed in.
 */
export function currentMember(env: SignInEnv, request: Request): Promise<CurrentMember> {
  let answer = answers.get(request);
  if (!answer) {
    answer = lookUp(env, request);
    answers.set(request, answer);
  }
  return answer;
}

/** The path and query of a request, for coming back after signing in. */
export function returnPath(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

export function signInRedirect(request: Request, clearCookies: boolean): Response {
  const headers = new Headers({
    Location: `/sign-in/?next=${encodeURIComponent(returnPath(request))}`,
    'Cache-Control': 'private, no-store',
  });
  if (clearCookies)
    for (const cookie of clearedSessionCookies()) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

/** The signed-in member, or a redirect to sign in that comes back here. */
export async function requireMember(
  env: SignInEnv,
  request: Request,
): Promise<Extract<CurrentMember, { signedIn: true }> | Response> {
  const member = await currentMember(env, request);
  if (!member.signedIn) return signInRedirect(request, member.clearCookies);
  return member;
}
