/// <reference types="@cloudflare/workers-types" />

// Helpers for the join pages. Each page is built once by Astro; these fetch
// the built page and fill in its `data-slot` elements on request with
// Cloudflare's HTMLRewriter, so the visitor gets finished HTML in one round
// trip and every flow works without JavaScript. Underscore-prefixed so
// Cloudflare Pages does not treat this file as a route.

import { signToken, verifyToken } from '@lasvegasfortransit/platform-core/signing';
import {
  INTERESTS,
  validReferral,
  type Interest,
} from '@lasvegasfortransit/platform-core/join-form';
import type { PlatformEnv } from '../../platform/join';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { builtPage, finishPage, SECURITY_HEADERS } from '../_page-response';

export { builtPage, SECURITY_HEADERS };

export interface JoinEnv extends Omit<PlatformEnv, 'PLATFORM_DB'> {
  ASSETS: Fetcher;
  PLATFORM_DB?: D1Database;
}

/** The platform environment, or null when the database or signing key is missing. */
export function platformEnv(env: JoinEnv): PlatformEnv | null {
  if (!env.PLATFORM_DB || !env.LVBT_LINK_SIGNING_SECRET) {
    console.error('join: PLATFORM_DB binding or LVBT_LINK_SIGNING_SECRET is missing');
    return null;
  }
  return { ...env, PLATFORM_DB: env.PLATFORM_DB as unknown as Db };
}

export const finish = finishPage;

export function redirect(location: string, extraHeaders: HeadersInit = {}): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Location', location);
  headers.set('Cache-Control', 'no-store');
  return new Response(null, { status: 303, headers });
}

/** Replace an element's text and show it. */
export function showText(text: string): HTMLRewriterElementContentHandlers {
  return {
    element(element) {
      element.setInnerContent(text);
      element.removeAttribute('hidden');
    },
  };
}

/**
 * Like showText, for text that contains the visitor's email address.
 * Cloudflare's email obfuscation would otherwise replace the address with
 * "[email protected]" for anyone without JavaScript, so the element is wrapped
 * in the comments that switch obfuscation off for it.
 */
export function showEmailText(text: string): HTMLRewriterElementContentHandlers {
  return {
    element(element) {
      element.setInnerContent(text);
      element.removeAttribute('hidden');
      element.before('<!--email_off-->', { html: true });
      element.after('<!--/email_off-->', { html: true });
    },
  };
}

export function show(): HTMLRewriterElementContentHandlers {
  return {
    element(element) {
      element.removeAttribute('hidden');
    },
  };
}

// The short-lived, signed record of what this browser just submitted, so the
// region step and the welcome page can continue without storing anything
// else or asking again.
export const JOIN_COOKIE = 'lvbt_join';
const JOIN_STEP_MINUTES = 60;

export interface JoinStep {
  personId: string;
  givenName: string;
  email: string;
  address: string;
  interests: Interest[];
  referral: string | null;
}

export async function joinStepCookie(secret: string, step: JoinStep): Promise<string> {
  const token = await signToken(secret, {
    purpose: 'join_step',
    subject: step.personId,
    expiresAt: Date.now() + JOIN_STEP_MINUTES * 60 * 1000,
    data: {
      givenName: step.givenName,
      email: step.email,
      address: step.address,
      interests: step.interests.join(','),
      referral: step.referral ?? '',
    },
  });
  return `${JOIN_COOKIE}=${token}; Path=/join/member; Max-Age=${JOIN_STEP_MINUTES * 60}; HttpOnly; Secure; SameSite=Lax`;
}

export async function readJoinStep(secret: string, request: Request): Promise<JoinStep | null> {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = new RegExp(`(?:^|;\\s*)${JOIN_COOKIE}=([^;]+)`).exec(cookie);
  if (!match?.[1]) return null;
  const payload = await verifyToken(secret, match[1], 'join_step');
  if (!payload) return null;
  return {
    personId: payload.subject,
    givenName: payload.data?.givenName ?? '',
    email: payload.data?.email ?? '',
    address: payload.data?.address ?? 'none',
    interests: (payload.data?.interests ?? '')
      .split(',')
      .filter((interest): interest is Interest => INTERESTS.includes(interest as Interest)),
    referral: validReferral(payload.data?.referral ?? null),
  };
}

export function wantsJson(request: Request): boolean {
  return (request.headers.get('Accept') ?? '').includes('application/json');
}
