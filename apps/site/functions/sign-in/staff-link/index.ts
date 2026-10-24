/// <reference types="@cloudflare/workers-types" />
import {
  memberHandoff,
  approveMemberHandoff,
  verifiedMemberProof,
} from '@lasvegasfortransit/platform-storage/staff-member-handoff';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import { SESSION_COOKIE, readCookie } from '@lasvegasfortransit/platform-core/web-auth';
import { builtPage, finish, redirect, showText } from '../../join/_page';
import { platformSignIn, refused, formOf, field, setValue, type SignInPagesEnv } from '../_shared';
export const onRequest: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const platform = platformSignIn(env);
  if (!platform) return new Response('Sign-in is unavailable.', { status: 503 });
  if (request.method !== 'GET' && request.method !== 'POST')
    return new Response(null, { status: 405 });
  if (request.method === 'POST' && request.headers.get('Origin') !== new URL(request.url).origin)
    return refused();
  const form = request.method === 'POST' ? await formOf(request) : null;
  const token = form
    ? field(form, 'request')
    : (new URL(request.url).searchParams.get('request') ?? '');
  const handoff = await memberHandoff(platform, token);
  if (!handoff)
    return new Response(
      'This account connection expired. Return to the Staff Portal and try again.',
      {
        status: 410,
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
      },
    );
  const sessionToken = readCookie(request, SESSION_COOKIE),
    session = sessionToken
      ? await verifiedMemberProof(
          platform,
          await hashWithSecret(platform.LVBT_SIGN_IN_SECRET, `session:${sessionToken}`),
        )
      : null;
  if (!session)
    return redirect(
      `/sign-in/?next=${encodeURIComponent(`/sign-in/staff-link/?request=${encodeURIComponent(token)}`)}`,
    );
  if (request.method === 'POST') {
    if (!sessionToken || !(await approveMemberHandoff(platform, token, sessionToken)))
      return new Response('This connection expired. Return to the Staff Portal and try again.', {
        status: 410,
        headers: { 'Cache-Control': 'no-store' },
      });
    return redirect(`${handoff.staff_origin}/sign-in/link-account/`, {
      'Referrer-Policy': 'no-referrer',
    });
  }
  const page = await builtPage(env, request, '/sign-in/staff-link/');
  const rewriter = new HTMLRewriter()
    .on('[data-slot="member-email"]', showText(session.email))
    .on('[data-slot="request"]', setValue(token));
  return finish(rewriter.transform(page), 200, {
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  });
};
