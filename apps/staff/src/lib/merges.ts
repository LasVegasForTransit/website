import { mergePeople, undoMerge } from '@lasvegasfortransit/platform-storage/merges';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { MergeSummary } from '@lasvegasfortransit/platform-storage/merge-views';
import type { ReviewItem } from '@lasvegasfortransit/platform-storage/reviews';
import type { StaffContext } from './context';
import { field } from './forms';
import { messageResponse } from './responses';
import { t } from '@lasvegasfortransit/platform-core/messages';
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
  const survivorId = item.existingId;
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: `review:combine:${item.id}`,
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse(t('staff.merge.combineExpired'), 409);
  if (item.resolvedAt) {
    return {
      error: t('staff.merge.reviewChanged'),
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
  if (result.kind === 'forbidden') return messageResponse(t('staff.common.accessDenied'), 403);
  if (result.kind === 'ok')
    return new Response(null, {
      status: 303,
      headers: { Location: `/review/combined/${result.value.mergeId}/` },
    });
  return {
    error:
      result.kind === 'invalid'
        ? t('staff.merge.combineReasonRequired')
        : 'reason' in result && result.reason === 'already_combined'
          ? t('staff.merge.alreadyCombined')
          : t('staff.merge.combineConflict'),
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
    return messageResponse(t('staff.merge.undoExpired'), 409);
  const result = await undoMerge(staff.db, staff.actor, {
    mergeId: item.id,
    reason,
    operationId: field(form, 'operation_id', 201),
  });
  if (result.kind === 'forbidden') return messageResponse(t('staff.common.accessDenied'), 403);
  if (result.kind === 'ok')
    return new Response(null, {
      status: 303,
      headers: { Location: `/review/combined/${item.id}/` },
    });
  return {
    error:
      result.kind === 'invalid'
        ? t('staff.merge.undoReasonRequired')
        : 'reason' in result && result.reason === 'undo_newer_merge_first'
          ? t('staff.merge.undoNewerFirst')
          : t('staff.merge.undoConflict'),
    reason,
  };
}
