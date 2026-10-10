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
    return 'Other account updates are still pending.';
  return row.expectedAccess
    ? 'Waiting to update account access.'
    : 'Waiting to remove account access.';
}
export function accessLabel(access: ProviderAccess, expected: boolean): string {
  if (access.state === 'granted') return expected ? 'Confirmed' : 'Still has access';
  if (access.state === 'absent') return expected ? 'Access missing' : 'Removal confirmed';
  const labels = {
    ambiguous_account: 'Account needs review',
    not_linked: 'Account not connected',
    not_mapped: 'Connection not set up',
    not_configured: 'Updates not set up',
    not_checked: 'Not checked yet',
    stale: 'Needs a fresh check',
    provider_unavailable: 'Service unavailable',
    rate_limited: 'Waiting for the service',
    permission_denied: 'Permission needs fixing',
    unknown: 'Couldn’t check access',
  };
  return access.reason ? labels[access.reason] : 'Not checked yet';
}
export function updateFailure(failure: string | null): string {
  if (failure === 'permission_denied')
    return 'LVBT’s connection doesn’t have permission to update this account. Ask Civic Tech to check it.';
  if (failure === 'rate_limited')
    return 'The service asked us to wait. Try the update again later.';
  if (failure === 'provider_unavailable')
    return 'The service was unavailable. Try the update again.';
  return 'The update failed. Try again or ask Civic Tech for help.';
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
