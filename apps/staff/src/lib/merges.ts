import { mergePeople, undoMerge } from '@lasvegasfortransit/platform-storage/merges';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { MergeSummary } from '@lasvegasfortransit/platform-storage/merge-views';
import type { ReviewItem } from '@lasvegasfortransit/platform-storage/reviews';
import type { StaffContext } from './context';
import { field } from './forms';
import { messageResponse } from './responses';
export interface MergeFailure {
  error: string;
  reason: string;
  survivorId?: string;
}
export async function combineAction(
  request: Request,
  staff: StaffContext,
  item: ReviewItem,
): Promise<Response | MergeFailure> {
  const form = await request.formData();
  const reason = field(form, 'reason', 2001);
  const survivorId = field(form, 'keep_person', 100);
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: `review:combine:${item.id}`,
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse('This page is out of date. Open the duplicate check again.', 409);
  if (item.resolvedAt || ![item.candidateId, item.existingId].includes(survivorId)) {
    return {
      error: 'This check has changed. Open the list of possible duplicates again.',
      reason,
      survivorId,
    };
  }
  const result = await mergePeople(staff.db, staff.actor, {
    survivorId,
    mergedId: survivorId === item.candidateId ? item.existingId : item.candidateId,
    reason,
    operationId: field(form, 'operation_id', 201),
    reviewId: item.id,
  });
  if (result.kind === 'forbidden') return messageResponse("You don't have access to this", 403);
  if (result.kind === 'ok')
    return new Response(null, {
      status: 303,
      headers: { Location: `/review/combined/${result.value.mergeId}/` },
    });
  return {
    error:
      result.kind === 'invalid'
        ? 'Enter a reason for combining these entries.'
        : 'These entries can’t be combined yet. Check their email addresses, accounts and current committees, then try again.',
    reason,
    survivorId,
  };
}
export async function uncombineAction(
  request: Request,
  staff: StaffContext,
  item: MergeSummary,
): Promise<Response | MergeFailure> {
  const form = await request.formData();
  const reason = field(form, 'reason', 2001);
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: `merge:undo:${item.id}`,
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse('This page is out of date. Open the combination again.', 409);
  const result = await undoMerge(staff.db, staff.actor, {
    mergeId: item.id,
    reason,
    operationId: field(form, 'operation_id', 201),
  });
  if (result.kind === 'forbidden') return messageResponse("You don't have access to this", 403);
  if (result.kind === 'ok')
    return new Response(null, {
      status: 303,
      headers: { Location: `/review/combined/${item.id}/` },
    });
  return {
    error:
      result.kind === 'invalid'
        ? 'Enter a reason for undoing this combination.'
        : 'This combination can’t be undone automatically because details, accounts or access have changed. Ask an administrator to check both entries.',
    reason,
  };
}
