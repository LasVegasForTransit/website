/// <reference types="@cloudflare/workers-types" />
import { t } from '@lasvegasfortransit/platform-core/messages';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { signToken, verifyToken } from '@lasvegasfortransit/platform-core/signing';
import {
  WorkspaceLinkService,
  type WorkspaceCompletion,
} from '@lasvegasfortransit/platform-storage/workspace-link';
import { normalizeEmail } from '@lasvegasfortransit/platform-storage/person-service';
import { googleResponse, PENDING_COOKIE, workspaceCookie } from '../../../platform/google-sign-in';
import {
  readCookie,
  sendCodeEmail,
  sessionCookies,
  validEmail,
  type SignInEnv,
} from '../../../platform/sign-in';
import { transactionalEmailHtml } from '../../../platform/transactional-email';
import { builtPage, finish, showText } from '../../join/_page';
import {
  field,
  fieldError,
  formOf,
  platformSignIn,
  refused,
  setValue,
  type SignInPagesEnv,
} from '../_shared';
const EMAIL_COOKIE = '__Host-lvbt_workspace_email';

async function linkingEmail(
  env: SignInEnv,
  request: Request,
  pending: string,
): Promise<string | null> {
  if (new URL(request.url).searchParams.has('change_email')) return null;
  const token = readCookie(request, EMAIL_COOKIE);
  if (!token) return null;
  const step = await verifyToken(env.LVBT_SIGN_IN_SECRET, token, 'workspace_email_step');
  return step?.subject === (await digestToken(pending)) ? (step.data?.email ?? null) : null;
}

interface LinkContext {
  env: SignInPagesEnv;
  request: Request;
  platform: SignInEnv;
  pending: string;
}
async function render(
  { env, request, platform, pending }: LinkContext,
  input: { status: number; notice?: string; email?: string; error?: 'email' | 'code' },
): Promise<Response> {
  const saved = await new WorkspaceLinkService(platform).pending(pending);
  if (!saved)
    return googleResponse('/sign-in/?google_error=1', [workspaceCookie(PENDING_COOKIE, '', 0)]);
  const page = await builtPage(env, request, '/sign-in/link-account/');
  const email = await linkingEmail(platform, request, pending);
  let rewriter = new HTMLRewriter().on(
    '[data-slot="workspace-account"]',
    showText(t('workspace.account', { email: saved.workspace_email })),
  );
  if (email)
    rewriter = rewriter
      .on('[data-slot="email-step"]', {
        element(e) {
          e.setAttribute('hidden', '');
        },
      })
      .on('[data-slot="code-step"]', {
        element(e) {
          e.removeAttribute('hidden');
        },
      })
      .on('[data-slot="sent-to"]', showText(t('workspace.sentTo', { email })));
  if (input.email) rewriter = rewriter.on('input[name="email"]', setValue(input.email));
  if (input.notice) rewriter = rewriter.on('[data-slot="notice"]', showText(input.notice));
  if (input.error) rewriter = fieldError(rewriter, input.error);
  return finish(rewriter.transform(page), input.status, {
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  });
}

function completeResponse(outcome: WorkspaceCompletion): Response | null {
  if (outcome.kind === 'ok')
    return googleResponse(outcome.returnTo, [
      workspaceCookie(PENDING_COOKIE, '', 0),
      workspaceCookie(EMAIL_COOKIE, '', 0),
      ...sessionCookies(outcome.session.token, outcome.session.expiresAt),
    ]);
  if (outcome.kind === 'expired')
    return googleResponse('/sign-in/?google_error=1', [
      workspaceCookie(PENDING_COOKIE, '', 0),
      workspaceCookie(EMAIL_COOKIE, '', 0),
    ]);
  return null;
}

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const platform = platformSignIn(env);
  const pending = readCookie(request, PENDING_COOKIE);
  if (!platform || !pending) return googleResponse('/sign-in/?google_error=1');
  return await render({ env, request, platform, pending }, { status: 200 });
};

async function requestLinkCode(
  { env, request, platform, pending }: LinkContext,
  email: string,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response> {
  if (!validEmail(email))
    return await render(
      { env, request, platform, pending },
      { status: 400, email, error: 'email' },
    );
  const outcome = await new WorkspaceLinkService(platform).requestCode(pending, {
    email,
    callerAddress: request.headers.get('CF-Connecting-IP') ?? 'unknown',
  });
  if (outcome.kind === 'expired') return googleResponse('/sign-in/?google_error=1');
  if (outcome.kind === 'rate_limited')
    return await render(
      { env, request, platform, pending },
      {
        status: 429,
        email,
        notice: t('signIn.rateLimited', {
          time: outcome.retryAfter.toLocaleTimeString('en-US', {
            timeZone: 'America/Los_Angeles',
            hour: 'numeric',
            minute: '2-digit',
          }),
        }),
      },
    );
  if (outcome.kind === 'issued') {
    const code = outcome.issued.code;
    const body = t('workspace.emailBody', { code });
    waitUntil(
      sendCodeEmail(platform, {
        to: email,
        subject: t('workspace.emailSubject', { code }),
        text: `${body}\n\n${t('workspace.emailIgnore')}`,
        html: transactionalEmailHtml({
          heading: t('workspace.heading'),
          body,
          note: t('workspace.emailIgnore'),
        }),
        template: 'workspace_link_code',
      }),
    );
  }
  const token = await signToken(platform.LVBT_SIGN_IN_SECRET, {
    purpose: 'workspace_email_step',
    subject: await digestToken(pending),
    expiresAt: Date.now() + 900_000,
    data: { email },
  });
  return googleResponse('/sign-in/link-account/', [workspaceCookie(EMAIL_COOKIE, token, 900)]);
}

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request, waitUntil }) => {
  if (request.headers.get('Origin') !== new URL(request.url).origin) return refused();
  const platform = platformSignIn(env);
  const pending = readCookie(request, PENDING_COOKIE);
  if (!platform || !pending) return googleResponse('/sign-in/?google_error=1');
  const form = await formOf(request);
  const service = new WorkspaceLinkService(platform);
  const action = field(form, 'action');
  if (action === 'request')
    return await requestLinkCode(
      { env, request, platform, pending },
      normalizeEmail(field(form, 'email').slice(0, 254)),
      waitUntil,
    );
  let outcome: WorkspaceCompletion;
  if (action === 'confirm') {
    const email = await linkingEmail(platform, request, pending);
    if (!email) return googleResponse('/sign-in/link-account/?change_email=1');
    outcome = await service.complete(pending, { email, code: field(form, 'code').slice(0, 32) });
  } else
    return new Response('Unknown action.', {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  const response = completeResponse(outcome);
  if (response) return response;
  return await render(
    { env, request, platform, pending },
    {
      status: outcome.kind === 'conflict' ? 409 : 400,
      notice: outcome.kind === 'conflict' ? t('workspace.conflict') : t('signIn.codeError'),
      error: 'code',
    },
  );
};
