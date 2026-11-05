import { recovery } from '../staff-link/index';
import {
  SESSION_COOKIE,
  readCookie,
  clearedSessionCookies,
} from '@lasvegasfortransit/platform-core/web-auth';
import { readSession, endSession, type AuthEnv } from '@lasvegasfortransit/platform-storage/auth';
import {
  workspaceConnection,
  approveWorkspaceConnection,
} from '@lasvegasfortransit/platform-storage/workspace-enrollment-connect';
import { builtPage, finish, redirect, showText, SECURITY_HEADERS } from '../../join/_page';
import { platformSignIn, formOf, field, setValue, type SignInPagesEnv } from '../_shared';
const expired = (env: SignInPagesEnv, request: Request) =>
  recovery(env, request, 410, 'This connection expired. Start again from the portal.');
async function submitConnection(
  platform: AuthEnv,
  input: {
    ticket: string;
    token: string;
    staffOrigin: string;
    returnTo: string;
    different: boolean;
  },
  context: { env: SignInPagesEnv; request: Request },
) {
  if (input.different) {
    await endSession(platform, input.token);
    const response = redirect(
      `/sign-in/workspace-connect/?request=${encodeURIComponent(input.ticket)}`,
    );
    for (const cookie of clearedSessionCookies()) response.headers.append('Set-Cookie', cookie);
    return response;
  }
  if (!(await approveWorkspaceConnection(platform, input.ticket, input.token)))
    return expired(context.env, context.request);
  return redirect(
    `${input.staffOrigin}/onboarding/connect/?next=${encodeURIComponent(input.returnTo)}`,
    { 'Referrer-Policy': 'no-referrer' },
  );
}
async function connectionPage(
  env: SignInPagesEnv,
  request: Request,
  input: { email: string; ticket: string; staffOrigin: string },
) {
  const page = await builtPage(env, request, '/sign-in/staff-link/');
  const rewriter = new HTMLRewriter()
    .on('h1', showText('Connect your existing LVBT account'))
    .on(
      '[data-slot="connection-intro"]',
      showText('Confirm this is your account. Review both accounts in the Staff Portal next.'),
    )
    .on('[data-slot="member-email"]', showText(input.email))
    .on('[data-slot="request"]', setValue(input.ticket))
    .on('form', {
      element(el) {
        el.setAttribute('action', '/sign-in/workspace-connect/');
      },
    })
    .on('[data-slot="different-member"]', {
      element(el) {
        el.replace(
          '<button form="different-account" class="staff-gate-link staff-text-button" type="submit">Switch account</button>',
          { html: true },
        );
      },
    })
    .on('[data-slot="connection-form"]', {
      element(el) {
        el.append(
          `<form id="different-account" method="post" action="/sign-in/workspace-connect/"><input type="hidden" name="request" value="${input.ticket}"><input type="hidden" name="action" value="different"></form>`,
          { html: true },
        );
      },
    });
  const response = finish(rewriter.transform(page), 200, {
    'Cache-Control': 'private, no-store',
  });
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set(
    'Content-Security-Policy',
    SECURITY_HEADERS['Content-Security-Policy'].replace(
      "form-action 'self' https://givebutter.com",
      `form-action 'self' ${input.staffOrigin}`,
    ),
  );
  return response;
}
export const onRequest: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const platform = platformSignIn(env),
    url = new URL(request.url);
  if (!platform)
    return recovery(env, request, 503, 'Sign-in is temporarily unavailable. Try again later.');
  if (!['GET', 'POST'].includes(request.method)) return new Response(null, { status: 405 });
  if (request.method === 'POST' && request.headers.get('Origin') !== url.origin)
    return recovery(env, request, 403, 'Return to the portal and try this form again.');
  const form = request.method === 'POST' ? await formOf(request) : null;
  const ticket = form ? field(form, 'request') : (url.searchParams.get('request') ?? '');
  const connection = await workspaceConnection(platform, ticket);
  if (connection?.member_origin !== url.origin) return expired(env, request);
  const token = readCookie(request, SESSION_COOKIE) ?? '',
    session = await readSession(platform, token);
  if (!session) return redirect(`/sign-in/?next=${encodeURIComponent(url.pathname + url.search)}`);
  if (session.type !== 'member')
    return recovery(env, request, 409, 'Sign in with your member account to connect it.');
  if (form)
    return submitConnection(
      platform,
      {
        ticket,
        token,
        staffOrigin: connection.staff_origin,
        returnTo: connection.return_to,
        different: field(form, 'action') === 'different',
      },
      { env, request },
    );
  return connectionPage(env, request, {
    email: session.person.email ?? '',
    ticket,
    staffOrigin: connection.staff_origin,
  });
};
