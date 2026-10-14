import type { ProviderAccess } from '@lasvegasfortransit/platform-core/access';
import { t } from '@lasvegasfortransit/platform-core/messages';
import {
  requestAccessRetry,
  removeAssignedAccess,
} from '@lasvegasfortransit/platform-storage/access-recovery';
import type { AssignmentEndReason } from '@lasvegasfortransit/platform-storage/committees';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { StaffContext } from './context';
import { field } from './forms';
import { messageResponse } from './responses';
export function accessLabel(
  access: ProviderAccess,
  expected: boolean,
  memberChannels = false,
): string {
  if (access.state === 'granted') {
    if (!expected) return t('staff.access.stillHasAccess');
    return memberChannels ? t('staff.access.hasMemberAccess') : t('staff.access.hasAccess');
  }
  if (access.state === 'absent') {
    if (expected) return t('staff.access.missing');
    return memberChannels ? t('staff.access.noMemberAccess') : t('staff.access.noAccess');
  }
  const labels = {
    ambiguous_account: t('staff.access.ambiguous'),
    not_linked: t('staff.access.notLinked'),
    not_mapped: t('staff.access.notMapped'),
    not_configured: t('staff.access.notConfigured'),
    not_checked: t('staff.access.notChecked'),
    stale: t('staff.access.stale'),
    provider_unavailable: t('staff.access.unavailable'),
    rate_limited: t('staff.access.rateLimited'),
    permission_denied: t('staff.access.permissionDenied'),
    unknown: t('staff.access.unknown'),
  };
  return access.reason ? labels[access.reason] : t('staff.access.notChecked');
}
export function updateFailure(failure: string | null): string {
  if (failure === 'permission_denied') return t('staff.access.failurePermission');
  if (failure === 'rate_limited') return t('staff.access.failureRateLimit');
  if (failure === 'provider_unavailable') return t('staff.access.failureUnavailable');
  return t('staff.access.failureUnknown');
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
    return { message: t('staff.access.reloadAction'), status: 400 };
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: `access:${action}:${target}`,
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse(t('staff.access.expiredForm'), 409);
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
  if (result.kind === 'forbidden') return messageResponse(t('staff.common.accessDenied'), 403);
  return {
    message:
      result.kind === 'invalid'
        ? t('staff.access.chooseRemovalReason')
        : t('staff.access.actionChanged'),
    status: result.kind === 'invalid' ? 400 : 409,
  };
}
