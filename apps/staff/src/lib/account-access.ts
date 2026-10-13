import type { ProviderAccess } from '@lasvegasfortransit/platform-core/access';
import type { AccessRow } from '@lasvegasfortransit/platform-storage/access-view';
import {
  requestAccessRetry,
  removeAssignedAccess,
} from '@lasvegasfortransit/platform-storage/access-recovery';
import type { AssignmentEndReason } from '@lasvegasfortransit/platform-storage/committees';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { StaffContext } from './context';
import { field } from './forms';
import { messageResponse } from './responses';
export function pendingAccessMessage(row: AccessRow): string {
  const visible = row.targetId === 'person' ? [row.discord] : [row.discord, row.googleWorkspace];
  const expected = row.expectedAccess ? 'granted' : 'absent';
  if (visible.some((access) => access.state === expected))
    return 'Another access change is still in progress.';
  return row.expectedAccess ? 'Adding access…' : 'Removing access…';
}
export function accessLabel(access: ProviderAccess, expected: boolean): string {
  if (access.state === 'granted') return expected ? 'Confirmed' : 'Still has access';
  if (access.state === 'absent') return expected ? 'Access missing' : 'Removal confirmed';
  const labels = {
    ambiguous_account: 'More than one account is connected',
    not_linked: 'Account not connected',
    not_mapped: 'Access has not been assigned',
    not_configured: 'An administrator needs to connect this service',
    not_checked: 'Not checked yet',
    stale: 'Last check is out of date',
    provider_unavailable: 'Service unavailable',
    rate_limited: 'Waiting for the service',
    permission_denied: 'An administrator needs to check the connection',
    unknown: 'Couldn’t check access',
  };
  return access.reason ? labels[access.reason] : 'Not checked yet';
}
export function updateFailure(failure: string | null): string {
  if (failure === 'permission_denied')
    return 'LVBT couldn’t update access. Ask an administrator to check the connection.';
  if (failure === 'rate_limited') return 'Please wait a moment, then try again.';
  if (failure === 'provider_unavailable')
    return 'This service is temporarily unavailable. Try again shortly.';
  return 'The update didn’t go through. Try again or ask an administrator for help.';
}
export interface AccessFeedback {
  message: string;
  status: number;
}
export async function submitAccessAction(
  request: Request,
  staff: StaffContext,
): Promise<Response | AccessFeedback> {
  const form = await request.formData(),
    action = field(form, 'action', 20),
    target = field(form, 'target', 201);
  if (!['retry', 'remove'].includes(action) || !target || target.length > 200)
    return { message: 'Reload the page and choose an update below.', status: 400 };
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: `access:${action}:${target}`,
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse(
      'This form expired or was already submitted. Reload the page and try again.',
      409,
    );
  const result =
    action === 'retry'
      ? await requestAccessRetry(staff.db, staff.actor, target)
      : await removeAssignedAccess(staff.db, staff.actor, {
          assignmentId: target,
          reason: field(form, 'reason', 30) as AssignmentEndReason,
          operationId: field(form, 'operation_id', 201),
        });
  if (result.kind === 'ok')
    return new Response(null, {
      status: 303,
      headers: { Location: new URL(request.url).pathname + new URL(request.url).search },
    });
  if (result.kind === 'forbidden') return messageResponse("You don't have access to this", 403);
  return {
    message:
      result.kind === 'invalid'
        ? 'Choose a reason for removing the member.'
        : 'This assignment or update has changed. Check the current details below.',
    status: result.kind === 'invalid' ? 400 : 409,
  };
}
