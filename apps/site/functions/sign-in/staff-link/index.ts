/// <reference types="@cloudflare/workers-types" />
import {
  memberHandoff,
  approveMemberHandoff,
  verifiedPublicAccountSession,
} from '@lasvegasfortransit/platform-storage/staff-member-handoff';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import { SESSION_COOKIE, readCookie } from '@lasvegasfortransit/platform-core/web-auth';
import { currentMember } from '../../../platform/sign-in';
import { builtPage, finish, redirect, showText, SECURITY_HEADERS } from '../../join/_page';
import { platformSignIn, formOf, field, setValue, type SignInPagesEnv } from '../_shared';
async function recovery(env: SignInPagesEnv, request: Request, status: number) {
  const title = status === 410 ? 'Connection expired' : 'Connection unavailable';
  const page = await builtPage(env, request, '/sign-in/staff-link/');
  const rewriter = new HTMLRewriter()
    .on('title', showText(`${title} · LVBT Staff Portal`))
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
    .on('[data-slot="portal-link"], .staff-identity', {
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
function handoffPageResponse(
  page: Response,
  staffOrigin: string,
  env: SignInPagesEnv,
  request: Request,
) {
  // The form posts locally, then returns to the portal origin recorded by the
  // verified handoff. Chromium also applies form-action to that redirect.
  const origin = new URL(staffOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== staffOrigin)
    return recovery(env, request, 410);
  const response = finish(page, 200, {
    'X-Robots-Tag': 'noindex, nofollow',
  });
  // no-referrer also removes Origin from a native POST, which would correctly
  // fail the CSRF check. same-origin retains it locally and sends no referrer
  // when navigation returns to the separate Staff Portal origin.
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set(
    'Content-Security-Policy',
    SECURITY_HEADERS['Content-Security-Policy'].replace(
      "form-action 'self' https://givebutter.com",
      `form-action 'self' ${origin.origin}`,
    ),
  );
  return response;
}
async function publicAccountSession(
  platform: NonNullable<ReturnType<typeof platformSignIn>>,
  token: string | null,
) {
  return token
    ? verifiedPublicAccountSession(
        platform,
        await hashWithSecret(platform.LVBT_SIGN_IN_SECRET, `session:${token}`),
      )
    : null;
}
function crossSiteSubmission(request: Request) {
  return request.method === 'POST' && request.headers.get('Origin') !== new URL(request.url).origin;
}
export const onRequest: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const platform = platformSignIn(env);
  if (!platform) return recovery(env, request, 503);
  if (request.method !== 'GET' && request.method !== 'POST')
    return new Response(null, { status: 405 });
  if (crossSiteSubmission(request)) return recovery(env, request, 403);
  const form = request.method === 'POST' ? await formOf(request) : null;
  const token = form
    ? field(form, 'request')
    : (new URL(request.url).searchParams.get('request') ?? '');
  const handoff = await memberHandoff(platform, token);
  if (!handoff) return recovery(env, request, 410);
  const sessionToken = readCookie(request, SESSION_COOKIE),
    session = await publicAccountSession(platform, sessionToken);
  if (!session && (await currentMember(platform, request)).signedIn)
    return recovery(env, request, 409);
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
    .on('.staff-identity', {
      element: (element) => {
        element.setAttribute('href', handoff.staff_origin);
      },
    })
    .on('[data-slot="different-member"]', {
      element: (element) => {
        element.setAttribute('href', `${handoff.staff_origin}/sign-in/link-account/?step=existing`);
      },
    })
    .on('[data-slot="request"]', setValue(token));
  return handoffPageResponse(rewriter.transform(page), handoff.staff_origin, env, request);
};
