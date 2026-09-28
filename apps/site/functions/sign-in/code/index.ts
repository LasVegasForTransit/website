/// <reference types="@cloudflare/workers-types" />

// /sign-in/code: "Check your email". GET shows the address this browser asked
// for, from its signed step cookie. POST checks the code and signs in.

import { t } from '../../../platform/messages';
import {
  clearedStepCookie,
  fromThisSite,
  noticeCookie,
  readStep,
  signInWithCode,
  type SignInStep,
} from '../../../platform/sign-in';
import { builtPage, finish, redirect, showEmailText, showText } from '../../join/_page';
import {
  appendCookies,
  field,
  fieldError,
  formOf,
  platformSignIn,
  refused,
  setValue,
  type SignInPagesEnv,
} from '../_shared';

interface PageState {
  step: SignInStep;
  code?: string;
  codeError?: string;
  notice?: string;
}

async function render(
  env: SignInPagesEnv,
  request: Request,
  state: PageState,
  status: number,
): Promise<Response> {
  const page = await builtPage(env, request, '/sign-in/code/');
  let rewriter = new HTMLRewriter()
    .on('[data-slot="sent-to"]', showEmailText(t('signIn.codeBody', { email: state.step.email })))
    .on('[data-slot="resend-email"]', setValue(state.step.email))
    .on('[data-slot="next"]', setValue(state.step.next));
  if (state.code) rewriter = rewriter.on('input[name="code"]', setValue(state.code));
  if (state.codeError) rewriter = fieldError(rewriter, 'code', state.codeError);
  if (state.notice) rewriter = rewriter.on('[data-slot="notice"]', showText(state.notice));
  return finish(rewriter.transform(page), status);
}

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const platform = platformSignIn(env);
  const step = platform ? await readStep(platform.LVBT_SIGN_IN_SECRET, request) : null;
  if (!step) return redirect('/sign-in/');
  return render(env, request, { step }, 200);
};

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  if (!fromThisSite(request)) return refused();
  const platform = platformSignIn(env);
  const step = platform ? await readStep(platform.LVBT_SIGN_IN_SECRET, request) : null;
  if (!platform || !step) return redirect('/sign-in/?expired');

  const code = field(await formOf(request), 'code').replaceAll(/\D/g, '');
  if (code.length !== 6) {
    return render(env, request, { step, code, codeError: t('signIn.codeError') }, 400);
  }

  const outcome = await signInWithCode(platform, step, code);
  switch (outcome.kind) {
    case 'signed_in': {
      const headers = appendCookies(new Headers(), [
        ...outcome.cookies,
        clearedStepCookie(),
        noticeCookie('signed_in'),
      ]);
      return redirect(step.next, headers);
    }
    case 'wrong':
      return render(
        env,
        request,
        { step, code, codeError: t('signIn.wrongCode', { count: outcome.triesLeft }) },
        400,
      );
    case 'too_many':
      return render(env, request, { step, notice: t('signIn.tooMany') }, 429);
    case 'expired':
      return render(env, request, { step, notice: t('signIn.expired') }, 400);
  }
};
