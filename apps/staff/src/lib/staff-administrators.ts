import { can } from '@lasvegasfortransit/platform-core/permissions';
import { t } from '@lasvegasfortransit/platform-core/messages';
import {
  clearedSessionCookies,
  readCookie,
  SESSION_COOKIE,
} from '@lasvegasfortransit/platform-core/web-auth';
import { endSession } from '@lasvegasfortransit/platform-storage/auth';
import { loadActor, staffAdminManage } from '@lasvegasfortransit/platform-storage/staff-roles';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { StaffAdministratorPerson } from '@lasvegasfortransit/platform-storage/staff-administrators';
import type { StaffContext } from './context';
import { field, fromSameOrigin } from './forms';
import { messageResponse } from './responses';

export type AdministratorAction = 'grant' | 'revoke';
export interface AdministratorFeedback {
  status: number;
  message: string;
}
export function administratorAction(value: string | null): AdministratorAction | null {
  return value === 'grant' || value === 'revoke' ? value : null;
}
export function administratorName(person: StaffAdministratorPerson): string {
  const name = [person.given_name, person.family_name].filter(Boolean).join(' ').trim();
  return name || (person.email ?? t('staff.common.nameNotRecorded'));
}
export function administratorTokenAction(personId: string, action: AdministratorAction): string {
  return `staff_admin:${action}:${personId}`;
}
function feedback(kind: 'invalid' | 'expired' | 'conflict' | 'last_admin'): AdministratorFeedback {
  const messages = {
    invalid: t('staff.administrators.invalid'),
    expired: t('staff.administrators.expired'),
    conflict: t('staff.administrators.changed'),
    last_admin: t('staff.administrators.lastAdmin'),
  };
  return { status: kind === 'invalid' ? 400 : 409, message: messages[kind] };
}
async function changedResponse(
  request: Request,
  staff: StaffContext,
  { self, enabled, signInSecret }: { self: boolean; enabled: boolean; signInSecret: string },
): Promise<Response> {
  const sessionToken = self ? readCookie(request, SESSION_COOKIE) : null;
  if (sessionToken)
    await endSession({ PLATFORM_DB: staff.db, LVBT_SIGN_IN_SECRET: signInSecret }, sessionToken);
  const headers = new Headers({
    Location: self
      ? '/sign-in/?administrator_removed=1'
      : `/administrators/?${enabled ? 'added' : 'removed'}=1`,
  });
  if (self) for (const cookie of clearedSessionCookies()) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}
export async function submitStaffAdministrator(
  request: Request,
  staff: StaffContext,
  personId: string,
  signInSecret: string,
): Promise<Response | AdministratorFeedback> {
  if (request.method !== 'POST' || !fromSameOrigin(request))
    return messageResponse(t('staff.common.accessDenied'), 403);
  const actor = await loadActor(staff.db, staff.actor.personId);
  if (!actor || !can(actor, 'staff_admin.manage'))
    return messageResponse(t('staff.common.accessDenied'), 403);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return feedback('invalid');
  }
  const action = administratorAction(field(form, 'action', 20));
  const operationId = field(form, 'operation_id', 201);
  const updatedAt = field(form, 'expected_updated_at', 51);
  const designatedAt = field(form, 'expected_designated_at', 51);
  if (!action || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(operationId) || !updatedAt)
    return feedback('invalid');
  if (
    !(await consumeFormToken(staff.db, actor, {
      action: administratorTokenAction(personId, action),
      token: field(form, 'token', 43),
    }))
  )
    return feedback('expired');
  const enabled = action === 'grant';
  const result = await staffAdminManage(staff.db, actor, {
    targetPersonId: personId,
    enabled,
    operationId,
    expectedState: { updatedAt, designatedAt: designatedAt || null },
    requireOrganizationAuthentication: true,
  });
  if (result.kind === 'ok')
    return changedResponse(request, staff, {
      self: !enabled && personId === actor.personId,
      enabled,
      signInSecret,
    });
  if (result.kind === 'forbidden' || result.kind === 'not_found')
    return messageResponse(t('staff.common.accessDenied'), 403);
  return feedback(result.kind);
}
