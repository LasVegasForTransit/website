/// <reference types="@cloudflare/workers-types" />

// Helpers shared by the sign-in and account handlers. Underscore-prefixed so
// Cloudflare Pages does not treat this file as a route.

import { signInEnv, type SignInEnv } from '../../platform/sign-in';
import type { JoinEnv } from '../join/_page';

export interface SignInPagesEnv extends JoinEnv {
  LVBT_SIGN_IN_SECRET?: string;
  LVBT_DEV_LOG_CODES?: string;
}

export function platformSignIn(env: SignInPagesEnv): SignInEnv | null {
  return signInEnv(env);
}

/** A POST from another site. Nothing changes. */
export function refused(): Response {
  return new Response('This form can only be sent from lasvegasfortransit.org.', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Set an input's value. */
export function setValue(value: string): HTMLRewriterElementContentHandlers {
  return {
    element(element) {
      element.setAttribute('value', value);
    },
  };
}

/** Show one field's error, with its own text, in the field and the summary. */
export function fieldError(rewriter: HTMLRewriter, field: string, message?: string): HTMLRewriter {
  const reveal = (text?: string): HTMLRewriterElementContentHandlers => ({
    element(element) {
      if (text) element.setInnerContent(text);
      element.removeAttribute('hidden');
    },
  });
  return rewriter
    .on('[data-slot="error-summary"]', reveal())
    .on(`[data-summary-for="${field}"]`, reveal())
    .on(`[data-summary-for="${field}"] a`, reveal(message))
    .on(`[data-error-for="${field}"]`, reveal(message))
    .on(`#${field}`, {
      element(element) {
        element.setAttribute('aria-invalid', 'true');
        const described = element.getAttribute('aria-describedby');
        element.setAttribute(
          'aria-describedby',
          described ? `${field}-error ${described}` : `${field}-error`,
        );
      },
    });
}

export async function formOf(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    return new FormData();
  }
}

/** A text field from a submitted form, or an empty string. */
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export function appendCookies(headers: Headers, cookies: string[]): Headers {
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return headers;
}
