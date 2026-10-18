import { can } from '@lasvegasfortransit/platform-core/permissions';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { clearedSessionCookies } from '@lasvegasfortransit/platform-core/web-auth';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import { deleteStaffPerson } from '@lasvegasfortransit/platform-storage/staff-deletion';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { StaffContext } from './context';
import { field, fromSameOrigin } from './forms';
import { messageResponse } from './responses';

export interface DeletionFeedback {
  status: number;
  message: string;
}
function deletedResponse(self: boolean): Response {
  const headers = new Headers({ Location: self ? '/sign-in/?deleted=1' : '/people/?deleted=1' });
  if (self) for (const cookie of clearedSessionCookies()) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}
function feedback(kind: 'invalid' | 'conflict' | 'last_admin'): DeletionFeedback {
  const messages = {
    invalid: t('staff.deletion.invalid'),
    conflict: t('staff.deletion.changed'),
    last_admin: t('staff.deletion.lastAdmin'),
  };
  return { status: kind === 'invalid' ? 400 : 409, message: messages[kind] };
}
export async function submitPersonDeletion(
  request: Request,
  staff: StaffContext,
  personId: string,
): Promise<Response | DeletionFeedback> {
  if (request.method !== 'POST' || !fromSameOrigin(request))
    return messageResponse(t('staff.common.accessDenied'), 403);
  const actor = await loadActor(staff.db, staff.actor.personId);
  if (!actor || !can(actor, 'person.delete'))
    return messageResponse(t('staff.common.accessDenied'), 403);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { status: 400, message: t('staff.deletion.invalid') };
  }
  if (field(form, 'action', 20) !== 'delete')
    return { status: 400, message: t('staff.deletion.invalid') };
  if (
    !(await consumeFormToken(staff.db, actor, {
      action: `person:delete:${personId}`,
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse(t('staff.deletion.expired'), 409);
  const result = await deleteStaffPerson(staff.db, actor, personId, {
    operationId: field(form, 'operation_id', 201),
    expectedUpdatedAt: field(form, 'expected_updated_at', 51),
  });
  if (result.kind === 'ok') return deletedResponse(actor.personId === personId);
  if (result.kind === 'forbidden' || result.kind === 'not_found')
    return messageResponse(t('staff.common.accessDenied'), 403);
  return feedback(result.kind);
}
