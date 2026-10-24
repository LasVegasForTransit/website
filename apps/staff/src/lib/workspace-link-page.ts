import type { AccessIdentity } from '@lasvegasfortransit/platform-integrations/access-identity';
import { messageResponse } from './responses';
import { readCookie, SESSION_COOKIE } from '@lasvegasfortransit/platform-core/web-auth';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import {
  staffHandoffProof,
  verifiedMemberProof,
} from '@lasvegasfortransit/platform-storage/staff-member-handoff';
import { staffAuthMode } from '@lasvegasfortransit/platform-integrations/staff-auth-config';
import {
  PENDING_COOKIE,
  googleResponse,
  workspaceCookie,
} from '@lasvegasfortransit/platform-integrations/google-sign-in';
import { linkService } from './staff-link-service';
import { EMAIL_COOKIE, linkingEmail, expiredWorkspaceConfirmation } from './workspace-email';
import { submitWorkspaceLink } from './workspace-link-actions';
import type { StaffEnv } from './context';
type Mode = 'google' | 'cloudflare-access';
type Saved = NonNullable<Awaited<ReturnType<ReturnType<typeof linkService>['pending']>>>;
export interface LinkPage {
  saved: Saved;
  email: string | null;
  member: { email: string | null; sessionHash: string } | null;
  step: string;
  enteredEmail: string;
  notice: string | null;
  status: number;
}
function principalMatches(saved: Saved, access?: AccessIdentity) {
  if (!('issuer' in saved)) return true;
  return (
    saved.issuer === access?.issuer &&
    saved.subject === access.subject &&
    access.expiresAt > new Date()
  );
}
async function currentMember(env: StaffEnv, request: Request, pending: string, mode: Mode) {
  const localToken = readCookie(request, SESSION_COOKIE);
  if (localToken) {
    const sessionHash = await hashWithSecret(env.LVBT_SIGN_IN_SECRET, `session:${localToken}`);
    const member = await verifiedMemberProof(env, sessionHash);
    if (member) return { ...member, sessionHash };
  }
  const handoff = readCookie(request, '__Host-lvbt_member_handoff');
  return handoff ? staffHandoffProof(env, handoff, { pending, mode }) : null;
}
function pageStep(params: URLSearchParams, email: string | null, hasMember: boolean) {
  const requested = params.get('step');
  if (requested === 'existing' || requested === 'new') return requested;
  if (email) return 'code';
  return hasMember ? 'review' : 'choose';
}
export async function workspaceLinkPage(
  env: StaffEnv,
  request: Request,
  waitUntil: (promise: Promise<unknown>) => void,
  access?: AccessIdentity,
) {
  const service = linkService(env),
    pending = readCookie(request, PENDING_COOKIE);
  const saved = pending ? await service.pending(pending) : null;
  if (!pending || !saved) return expiredWorkspaceConfirmation();
  if (!principalMatches(saved, access))
    return messageResponse("You don't have access to this", 403);
  if (request.method === 'GET' && new URL(request.url).searchParams.has('change_email'))
    return googleResponse('/sign-in/link-account/?step=existing', [
      workspaceCookie(EMAIL_COOKIE, '', 0),
    ]);
  const mode = staffAuthMode(env);
  if (!mode) return messageResponse('Sign-in is unavailable.', 503);
  const member = await currentMember(env, request, pending, mode),
    email = await linkingEmail(env, request, pending);
  const params = new URL(request.url).searchParams;
  const page: LinkPage = {
    saved,
    email,
    member,
    step: pageStep(params, email, Boolean(member)),
    enteredEmail: '',
    notice: params.has('expired') ? 'This sign-in attempt expired. Request a new code.' : null,
    status: 200,
  };
  return request.method === 'POST'
    ? submitWorkspaceLink({ env, request, pending, mode, page, waitUntil })
    : page;
}
