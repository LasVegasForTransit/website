import { t } from '@lasvegasfortransit/platform-core/messages';
import { readCookie, sessionCookies } from '@lasvegasfortransit/platform-core/web-auth';
import {
  googleResponse,
  PENDING_COOKIE,
  workspaceCookie,
} from '@lasvegasfortransit/platform-integrations/google-sign-in';
import { WorkspaceLinkService } from '@lasvegasfortransit/platform-storage/workspace-link';
import { normalizeEmail } from '@lasvegasfortransit/platform-storage/person-service';
import { EMAIL_COOKIE, linkingEmail, requestLinkCode } from './workspace-email';
import type { StaffEnv } from './context';
import { field } from './forms';
interface SubmitContext {
  env: StaffEnv;
  request: Request;
  pending: string;
  waitUntil: (promise: Promise<unknown>) => void;
}
async function submitEmail(context: SubmitContext, form: FormData) {
  const email = normalizeEmail(field(form, 'email'));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { notice: t('signIn.emailError'), status: 400, enteredEmail: email };
  return await requestLinkCode(context.env, {
    pending: context.pending,
    email,
    callerAddress: context.request.headers.get('CF-Connecting-IP') ?? 'unknown',
    waitUntil: context.waitUntil,
  });
}
async function submitCode(context: SubmitContext, form: FormData, email: string) {
  const result = await new WorkspaceLinkService(context.env).complete(context.pending, {
    email,
    code: field(form, 'code', 32),
  });
  if (result.kind === 'ok')
    return googleResponse(result.returnTo, [
      workspaceCookie(PENDING_COOKIE, '', 0),
      workspaceCookie(EMAIL_COOKIE, '', 0),
      ...sessionCookies(result.session.token, result.session.expiresAt),
    ]);
  if (result.kind === 'expired') return googleResponse('/sign-in/?google_error=1');
  return {
    notice: result.kind === 'conflict' ? t('workspace.conflict') : t('signIn.codeError'),
    status: result.kind === 'conflict' ? 409 : 400,
    enteredEmail: '',
  };
}
export async function workspaceLinkPage(
  env: StaffEnv,
  request: Request,
  waitUntil: (promise: Promise<unknown>) => void,
) {
  const pending = readCookie(request, PENDING_COOKIE);
  const saved = pending ? await new WorkspaceLinkService(env).pending(pending) : null;
  if (!pending || !saved) return googleResponse('/sign-in/?google_error=1');
  const email = await linkingEmail(env, request, pending);
  const page = { saved, email, notice: null as string | null, enteredEmail: '', status: 200 };
  if (request.method !== 'POST') return page;
  const form = await request.formData();
  const context = { env, request, pending, waitUntil };
  const action = field(form, 'action');
  const result =
    action === 'request'
      ? await submitEmail(context, form)
      : action === 'confirm' && email
        ? await submitCode(context, form, email)
        : new Response('Unknown action.', { status: 400 });
  return result instanceof Response ? result : { ...page, ...result };
}
