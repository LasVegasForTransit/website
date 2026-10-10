import { t } from '@lasvegasfortransit/platform-core/messages';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { signToken, verifyToken } from '@lasvegasfortransit/platform-core/signing';
import { readCookie } from '@lasvegasfortransit/platform-core/web-auth';
import { sendEmail, escapeHtml } from '@lasvegasfortransit/platform-integrations/email';
import {
  googleResponse,
  workspaceCookie,
} from '@lasvegasfortransit/platform-integrations/google-sign-in';
import { WorkspaceLinkService } from '@lasvegasfortransit/platform-storage/workspace-link';
import type { StaffEnv } from './context';
export const EMAIL_COOKIE = '__Host-lvbt_workspace_email';
export async function linkingEmail(env: StaffEnv, request: Request, pending: string) {
  if (new URL(request.url).searchParams.has('change_email')) return null;
  const cookie = readCookie(request, EMAIL_COOKIE);
  const step = cookie
    ? await verifyToken(env.LVBT_SIGN_IN_SECRET, cookie, 'workspace_email_step')
    : null;
  return step?.subject === (await digestToken(pending)) ? (step.data?.email ?? null) : null;
}
export async function requestLinkCode(
  env: StaffEnv,
  input: {
    pending: string;
    email: string;
    callerAddress: string;
    waitUntil: (promise: Promise<unknown>) => void;
  },
) {
  const result = await new WorkspaceLinkService(env).requestCode(input.pending, {
    email: input.email,
    callerAddress: input.callerAddress,
  });
  if (result.kind === 'expired') return googleResponse('/sign-in/?google_error=1');
  if (result.kind === 'rate_limited')
    return new Response('Too many attempts. Please try again later.', { status: 429 });
  if (result.kind === 'issued') {
    const body = t('workspace.emailBody', { code: result.issued.code });
    input.waitUntil(
      sendEmail(
        { resendApiKey: env.LVBT_RESEND_API_KEY },
        {
          to: input.email,
          subject: t('workspace.emailSubject', { code: result.issued.code }),
          text: `${body}\n\n${t('workspace.emailIgnore')}`,
          html: `<p>${escapeHtml(body)}</p><p>${escapeHtml(t('workspace.emailIgnore'))}</p>`,
          template: 'workspace_link_code',
        },
      ),
    );
  }
  const step = await signToken(env.LVBT_SIGN_IN_SECRET, {
    purpose: 'workspace_email_step',
    subject: await digestToken(input.pending),
    expiresAt: Date.now() + 900_000,
    data: { email: input.email },
  });
  return googleResponse('/sign-in/link-account/', [workspaceCookie(EMAIL_COOKIE, step, 900)]);
}
