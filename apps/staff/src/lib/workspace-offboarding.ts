import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import { reviewWorkspaceOffboarding } from '@lasvegasfortransit/platform-storage/workspace-offboarding';
import type { StaffContext } from './context';
import { field, fromSameOrigin } from './forms';
import { messageResponse } from './responses';

export function workspaceReviewAction(identityRecordId: string, revision: number): string {
  return `workspace-review:${identityRecordId}:${revision}`;
}
export async function submitWorkspaceReview(
  request: Request,
  staff: StaffContext,
): Promise<Response> {
  if (!fromSameOrigin(request)) return messageResponse('Reload this page and try again.', 403);
  const form = await request.formData();
  const identityRecordId = field(form, 'identity_id', 201);
  const revision = Number(field(form, 'revision', 20));
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: workspaceReviewAction(identityRecordId, revision),
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse('This form has expired. Reload the review list and try again.', 409);
  const result = await reviewWorkspaceOffboarding(staff.db, staff.actor, {
    identityRecordId,
    expectedRevision: revision,
    operationId: field(form, 'operation_id', 121),
  });
  if (result.kind === 'forbidden') return messageResponse('You don’t have access to this', 403);
  if (result.kind !== 'ok')
    return messageResponse(
      'This account review has changed. Reload the list and review it again.',
      409,
    );
  return new Response(null, { status: 303, headers: { Location: '/offboarding/?saved=1' } });
}
