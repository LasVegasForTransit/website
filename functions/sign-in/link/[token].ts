/// <reference types="@cloudflare/workers-types" />

// /sign-in/link/<token>: the sign-in email's button. GET shows a "Sign in"
// button, or the expired state, without using the link, because email
// security scanners open every link in an email. POST uses the link and
// signs this browser in, whichever device asked for the code.

import {
  fromThisSite,
  linkReady,
  noticeCookie,
  safeNext,
  signInWithLink,
} from '../../../platform/sign-in';
import { builtPage, finish, redirect, show } from '../../join/_page';
import {
  appendCookies,
  field,
  formOf,
  platformSignIn,
  refused,
  setValue,
  type SignInPagesEnv,
} from '../_shared';

const HIDE: HTMLRewriterElementContentHandlers = {
  element(element) {
    element.setAttribute('hidden', '');
  },
};

async function render(
  env: SignInPagesEnv,
  request: Request,
  state: { expired: boolean; next: string },
  status: number,
): Promise<Response> {
  const page = await builtPage(env, request, '/sign-in/link/');
  const url = new URL(request.url);
  let rewriter = new HTMLRewriter()
    .on('[data-slot="link-form"]', {
      element(element) {
        element.setAttribute('action', url.pathname);
      },
    })
    .on('[data-slot="next"]', setValue(state.next));
  if (state.expired) {
    rewriter = rewriter.on('[data-slot="ready"]', HIDE).on('[data-slot="expired"]', show());
  }
  return finish(rewriter.transform(page), status, { 'Referrer-Policy': 'no-referrer' });
}

function tokenFrom(params: Record<string, string | string[]>): string {
  const token = params.token;
  return typeof token === 'string' ? token : '';
}

export const onRequestGet: PagesFunction<SignInPagesEnv, 'token'> = async ({
  env,
  request,
  params,
}) => {
  const next = safeNext(new URL(request.url).searchParams.get('next'));
  const platform = platformSignIn(env);
  const live = platform ? await linkReady(platform, tokenFrom(params)) : false;
  return render(env, request, { expired: !live, next }, live ? 200 : 410);
};

export const onRequestPost: PagesFunction<SignInPagesEnv, 'token'> = async ({
  env,
  request,
  params,
}) => {
  if (!fromThisSite(request)) return refused();
  const next = safeNext(field(await formOf(request), 'next'));
  const platform = platformSignIn(env);
  const outcome = platform
    ? await signInWithLink(platform, tokenFrom(params))
    : { kind: 'expired' as const };
  if (outcome.kind === 'expired') return render(env, request, { expired: true, next }, 410);
  return redirect(
    next,
    appendCookies(new Headers(), [...outcome.cookies, noticeCookie('signed_in')]),
  );
};
