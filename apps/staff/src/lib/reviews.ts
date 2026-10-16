import { keepSeparate } from '@lasvegasfortransit/platform-storage/reviews';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { StaffContext } from './context';
import { field } from './forms';
import { messageResponse } from './responses';
const REASONS: Record<string, string> = {
  'same phone': t('staff.review.sharedPhone'),
  'same name and ZIP code': t('staff.review.matchingNameZip'),
  'same email, unverified': t('staff.review.unverifiedEmail'),
};
export function reviewReason(value: string): string {
  return Object.hasOwn(REASONS, value) ? REASONS[value] : t('staff.review.possibleDuplicate');
}
export function submittedEmail(details: string | null): string | null {
  if (!details) return null;
  const value: unknown = JSON.parse(details);
  return value && typeof value === 'object' && 'email' in value && typeof value.email === 'string'
    ? value.email
    : null;
}
export async function separateAction(
  request: Request,
  staff: StaffContext,
  reviewId: string,
): Promise<Response> {
  const form = await request.formData();
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: `review:separate:${reviewId}`,
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse(t('staff.review.separateExpired'), 409);
  const result = await keepSeparate(staff.db, staff.actor, reviewId, {
    operationId: field(form, 'operation_id', 201),
    note: field(form, 'note', 2001),
  });
  if (result.kind === 'forbidden') return messageResponse(t('staff.common.accessDenied'), 403);
  if (result.kind !== 'ok') return messageResponse(t('staff.review.separateChanged'), 409);
  return new Response(null, { status: 303, headers: { Location: `/review/${reviewId}/` } });
}
