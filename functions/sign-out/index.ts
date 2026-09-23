/// <reference types="@cloudflare/workers-types" />

// /sign-out: the header's "Sign out" button posts here. It ends the session
// on the server, clears both sign-in cookies and shows the signed-out page.
// GET falls through to that built page.

import { clearedSessionCookies, fromThisSite, signOut } from '../../platform/sign-in';
import { redirect } from '../join/_page';
import { appendCookies, platformSignIn, refused, type SignInPagesEnv } from '../sign-in/_shared';

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  if (!fromThisSite(request)) return refused();
  const platform = platformSignIn(env);
  const cookies = platform ? await signOut(platform, request) : clearedSessionCookies();
  return redirect('/sign-out/', appendCookies(new Headers(), cookies));
};
