import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import {
  requestGoogleGroupAccessUpdate,
  assignGoogleGroupMember,
  type GoogleGroupAction,
} from '@lasvegasfortransit/platform-storage/google-group-actions';
import type { StaffContext } from './context';
import { field } from './forms';
import { messageResponse } from './responses';
export async function googleGroupFormAction(
  input: Pick<
    GoogleGroupAction,
    'groupEmail' | 'personId' | 'identityId' | 'expectedSnapshot' | 'expectedAccess'
  > & { committeeId: string },
) {
  return `google-group:${await digestToken(JSON.stringify([input.groupEmail, input.personId, input.identityId, input.expectedSnapshot, input.expectedAccess, input.committeeId]))}`;
}
export async function submitGoogleGroupAction(
  request: Request,
  staff: StaffContext,
): Promise<Response | { message: string; status: number }> {
  const form = await request.formData();
  const choice = field(form, 'choice', 20),
    expected = field(form, 'expected_access', 6),
    committeeId = field(form, 'committee_id', 201);
  if (!['restore', 'remove', 'assign'].includes(choice) || !['true', 'false'].includes(expected))
    return { message: t('staff.googleGroups.invalidAction'), status: 400 };
  const input = {
    groupEmail: new URL(request.url).searchParams.get('group') ?? '',
    personId: field(form, 'person_id', 27),
    identityId: field(form, 'identity_id', 129),
    expectedSnapshot: field(form, 'snapshot', 513),
    expectedAccess: expected === 'true',
    committeeId,
    operationId: field(form, 'operation_id', 121),
    configuration: staff.accessConfiguration?.google_workspace ?? {
      configured: false,
      contextId: '',
    },
    consoleGroupEmail: staff.googleGroups?.consoleGroupEmail ?? null,
  };
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: await googleGroupFormAction(input),
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse(t('staff.access.expiredForm'), 409);
  if ((choice === 'restore') !== input.expectedAccess)
    return { message: t('staff.googleGroups.invalidAction'), status: 400 };
  const result =
    choice === 'assign'
      ? await assignGoogleGroupMember(staff.db, staff.actor, input, new Date())
      : await requestGoogleGroupAccessUpdate(staff.db, staff.actor, input, new Date());
  if (result.kind === 'ok')
    return new Response(null, {
      status: 303,
      headers: { Location: new URL(request.url).pathname + new URL(request.url).search },
    });
  if (result.kind === 'forbidden') return messageResponse(t('staff.common.accessDenied'), 403);
  return { message: t('staff.googleGroups.changed'), status: 409 };
}
