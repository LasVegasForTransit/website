/// <reference types="@cloudflare/workers-types" />
import { googleCallback } from '../../../../platform/google-sign-in';
import { platformSignIn, type SignInPagesEnv } from '../../_shared';
export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const platform = platformSignIn(env);
  if (!platform)
    return new Response('Sign-in is unavailable.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  return await googleCallback({ ...platform, ...env, PLATFORM_DB: platform.PLATFORM_DB }, request);
};
