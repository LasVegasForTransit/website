/// <reference types="@cloudflare/workers-types" />

// /sign-in: ask for a code. GET serves the built page, or sends a member who
// is already signed in straight on. POST asks for a code and goes to the code
// page, answering the same way whether or not the email is on LVBT's list.

import { t } from '../../platform/messages';
import {
  askForCode,
  currentMember,
  fromThisSite,
  safeNext,
  stepCookie,
} from '../../platform/sign-in';
import { builtPage, finish, redirect, showText } from '../join/_page';
import {
  field,
  fieldError,
  formOf,
  platformSignIn,
  refused,
  setValue,
  type SignInPagesEnv,
} from './_shared';

interface PageState {
  next: string;
  email?: string;
  emailError?: boolean;
  notice?: string;
}

async function render(
  env: SignInPagesEnv,
  request: Request,
  state: PageState,
  status: number,
): Promise<Response> {
  const page = await builtPage(env, request, '/sign-in/');
  let rewriter = new HTMLRewriter().on('[data-slot="next"]', setValue(state.next));
  if (state.email) rewriter = rewriter.on('input[name="email"]', setValue(state.email));
  if (state.emailError) rewriter = fieldError(rewriter, 'email');
  if (state.notice) rewriter = rewriter.on('[data-slot="notice"]', showText(state.notice));
  return finish(rewriter.transform(page), status);
}

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get('next'));
  const platform = platformSignIn(env);
  if (platform && (await currentMember(platform, request)).signedIn) return redirect(next);
  const notice = url.searchParams.has('expired') ? t('signIn.expired') : undefined;
  return render(env, request, { next, notice }, 200);
};

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request, waitUntil }) => {
  if (!fromThisSite(request)) return refused();
  const form = await formOf(request);
  const email = field(form, 'email').trim().slice(0, 254);
  const next = safeNext(field(form, 'next'));
  const platform = platformSignIn(env);
  if (!platform) {
    return render(env, request, { next, email, notice: t('signIn.unavailable') }, 503);
  }

  const outcome = await askForCode(platform, {
    email,
    next,
    callerAddress: request.headers.get('CF-Connecting-IP') ?? 'unknown',
    origin: new URL(request.url).origin,
  });
  switch (outcome.kind) {
    case 'invalid':
      return render(env, request, { next, email, emailError: true }, 400);
    case 'rate_limited':
      return render(
        env,
        request,
        { next, email, notice: t('signIn.rateLimited', { time: outcome.retryAfter }) },
        429,
      );
    case 'sent': {
      if (outcome.send) {
        const send = outcome.send;
        waitUntil(
          send().then((result) => {
            if (result !== 'sent') console.error(`sign-in: code email ${result}`);
          }),
        );
      }
      const cookie = await stepCookie(platform.LVBT_SIGN_IN_SECRET, outcome.step);
      return redirect('/sign-in/code/', { 'Set-Cookie': cookie });
    }
  }
};
