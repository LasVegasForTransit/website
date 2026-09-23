/// <reference types="@cloudflare/workers-types" />

// Helpers for the join pages. Each page is built once by Astro; these fetch
// the built page and fill in its `data-slot` elements on request with
// Cloudflare's HTMLRewriter, so the visitor gets finished HTML in one round
// trip and every flow works without JavaScript. Underscore-prefixed so
// Cloudflare Pages does not treat this file as a route.

import { signToken, verifyToken } from '../../platform/core/signing';
import type { PlatformEnv } from '../../platform/join';
import type { Db } from '../../platform/storage/db';

export interface JoinEnv extends Omit<PlatformEnv, 'PLATFORM_DB'> {
  ASSETS: Fetcher;
  PLATFORM_DB?: D1Database;
}

// The site-wide security headers from public/_headers. Pages applies that
// file to static files only, so responses built here set them directly. A
// test keeps this copy identical to the file.
export const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com; frame-src 'self'; connect-src 'self' https://cloudflareinsights.com https://events.lasvegasfortransit.org; form-action 'self' https://givebutter.com; object-src 'none'; upgrade-insecure-requests",
};

/** The platform environment, or null when the database or signing key is missing. */
export function platformEnv(env: JoinEnv): PlatformEnv | null {
  if (!env.PLATFORM_DB || !env.LVBT_LINK_SIGNING_SECRET) {
    console.error('join: PLATFORM_DB binding or LVBT_LINK_SIGNING_SECRET is missing');
    return null;
  }
  return { ...env, PLATFORM_DB: env.PLATFORM_DB as unknown as Db };
}

/** Fetch a built page, following the trailing-slash redirect Pages may send. */
export async function builtPage(env: JoinEnv, request: Request, path: string): Promise<Response> {
  let url = new URL(path, request.url);
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
    const location = response.headers.get('Location');
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    return response;
  }
  throw new Error(`join: too many redirects fetching ${path}`);
}

export function finish(
  response: Response,
  status: number,
  extraHeaders: HeadersInit = {},
): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  headers.set('Cache-Control', 'no-store');
  headers.delete('ETag');
  headers.delete('Content-Length');
  for (const [name, value] of new Headers(extraHeaders)) headers.append(name, value);
  return new Response(response.body, { status, headers });
}

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
}

export async function joinStepCookie(secret: string, step: JoinStep): Promise<string> {
  const token = await signToken(secret, {
    purpose: 'join_step',
    subject: step.personId,
    expiresAt: Date.now() + JOIN_STEP_MINUTES * 60 * 1000,
    data: { givenName: step.givenName, email: step.email, address: step.address },
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
  };
}

export function wantsJson(request: Request): boolean {
  return (request.headers.get('Accept') ?? '').includes('application/json');
}
