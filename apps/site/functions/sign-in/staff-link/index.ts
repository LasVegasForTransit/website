/// <reference types="@cloudflare/workers-types" />
import {
  memberHandoff,
  approveMemberHandoff,
  verifiedMemberProof,
} from '@lasvegasfortransit/platform-storage/staff-member-handoff';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import { SESSION_COOKIE, readCookie } from '@lasvegasfortransit/platform-core/web-auth';
import { builtPage, finish, redirect, showText } from '../../join/_page';
import { platformSignIn, formOf, field, setValue, type SignInPagesEnv } from '../_shared';
async function recovery(env: SignInPagesEnv, request: Request, status: number) {
  const title = status === 410 ? 'Connection expired' : 'Connection unavailable';
  const page = await builtPage(env, request, '/sign-in/staff-link/');
  const rewriter = new HTMLRewriter()
    .on('title', showText(`${title} — Las Vegans for Better Transit`))
    .on('h1', showText(title))
    .on('[data-slot="connection-intro"]', showText('Return to the Staff Portal and start again.'))
    .on('[data-slot="connection-form"]', {
      element: (element) => {
        element.remove();
      },
    })
    .on('[data-slot="connection-recovery"]', {
      element: (element) => {
        element.removeAttribute('hidden');
      },
    })
    .on('[data-slot="portal-link"]', {
      element: (element) => {
        element.setAttribute(
          'href',
          new URL(request.url).hostname.includes('preview')
            ? 'https://staff-preview.lasvegasfortransit.org/'
            : 'https://staff.lasvegasfortransit.org/',
        );
      },
    });
  return finish(rewriter.transform(page), status, { 'Referrer-Policy': 'no-referrer' });
}
export const onRequest: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const platform = platformSignIn(env);
  if (!platform) return recovery(env, request, 503);
  if (request.method !== 'GET' && request.method !== 'POST')
    return new Response(null, { status: 405 });
  if (request.method === 'POST' && request.headers.get('Origin') !== new URL(request.url).origin)
    return recovery(env, request, 403);
  const form = request.method === 'POST' ? await formOf(request) : null;
  const token = form
    ? field(form, 'request')
    : (new URL(request.url).searchParams.get('request') ?? '');
  const handoff = await memberHandoff(platform, token);
  if (!handoff) return recovery(env, request, 410);
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
      return recovery(env, request, 410);
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
