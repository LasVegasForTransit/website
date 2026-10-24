import { normalizeEmail } from '@lasvegasfortransit/platform-storage/person-service';
import { beginMemberHandoff } from '@lasvegasfortransit/platform-storage/staff-member-handoff';
import {
  googleResponse,
  workspaceCookie,
} from '@lasvegasfortransit/platform-integrations/google-sign-in';
import { requestLinkCode, expiredWorkspaceConfirmation } from './workspace-email';
import { completedStaffSetup } from './onboarding';
import { messageResponse } from './responses';
import { linkService } from './staff-link-service';
import { field } from './forms';
import type { StaffEnv } from './context';
import type { LinkPage } from './workspace-link-page';
interface SubmitContext {
  env: StaffEnv;
  request: Request;
  pending: string;
  mode: 'google' | 'cloudflare-access';
  page: LinkPage;
  waitUntil: (promise: Promise<unknown>) => void;
}
function submitMemberHandoff({ env, request, pending, mode }: SubmitContext) {
  return (async () => {
    const origin =
      env.LVBT_MEMBER_ORIGIN ??
      (new URL(request.url).hostname.includes('preview')
        ? 'https://preview.lasvegasfortransit.org'
        : 'https://lasvegasfortransit.org');
    const memberOrigin = new URL(origin);
    if (memberOrigin.protocol !== 'https:' || memberOrigin.origin !== origin)
      return messageResponse(
        'Account sign-in is unavailable. Ask an LVBT administrator for help.',
        503,
      );
    const handoff = await beginMemberHandoff(env, pending, {
      mode,
      staffOrigin: new URL(request.url).origin,
    });
    return googleResponse(`${origin}/sign-in/staff-link/?request=${encodeURIComponent(handoff)}`, [
      workspaceCookie('__Host-lvbt_member_handoff', handoff, 600),
    ]);
  })();
}
async function submitEmail(context: SubmitContext, form: FormData) {
  const enteredEmail = normalizeEmail(field(form, 'email'));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(enteredEmail))
    return {
      ...context.page,
      step: 'existing',
      enteredEmail,
      notice: 'Enter a valid email address.',
      status: 400,
    };
  return requestLinkCode(context.env, {
    pending: context.pending,
    email: enteredEmail,
    callerAddress: context.request.headers.get('CF-Connecting-IP') ?? 'unknown',
    waitUntil: context.waitUntil,
  });
}
async function submitCompletion(context: SubmitContext, form: FormData) {
  const { env, pending, page } = context,
    service = linkService(env),
    action = field(form, 'action');
  if (action === 'create') {
    const givenName = field(form, 'givenName', 101).trim(),
      familyName = field(form, 'familyName', 101).trim();
    if (!givenName || givenName.length > 100 || familyName.length > 100)
      return { ...page, step: 'new', notice: 'Enter your name to continue.', status: 400 };
    return finish(context, await service.createAccount(pending, { givenName, familyName }));
  }
  if (action === 'connect-member' && page.member)
    return finish(
      context,
      page.member.handoffToken
        ? await service.completeForMemberHandoff(pending, page.member.handoffToken)
        : await service.completeForMemberProof(pending, page.member.sessionHash),
    );
  if (action === 'confirm' && page.email)
    return finish(
      context,
      await service.complete(pending, { email: page.email, code: field(form, 'code', 32) }),
    );
  return messageResponse('Return to account setup and try again.', 400);
}
function finish(
  context: SubmitContext,
  result: Awaited<ReturnType<ReturnType<typeof linkService>['complete']>>,
) {
  if (result.kind === 'ok') return completedStaffSetup(result);
  if (result.kind === 'expired' || result.kind === 'too_many')
    return expiredWorkspaceConfirmation();
  return {
    ...context.page,
    notice:
      result.kind === 'conflict'
        ? 'We couldn’t connect these accounts. Ask an LVBT administrator for help.'
        : 'That code didn’t match. Check the latest email and try again.',
    status: result.kind === 'conflict' ? 409 : 400,
  };
}
export async function submitWorkspaceLink(context: SubmitContext) {
  if (context.request.headers.get('Origin') !== new URL(context.request.url).origin)
    return messageResponse('Reload this page and try again.', 403);
  const form = await context.request.formData();
  switch (field(form, 'action')) {
    case 'request':
      return submitEmail(context, form);
    case 'use-member':
      return submitMemberHandoff(context);
    default:
      return submitCompletion(context, form);
  }
}
