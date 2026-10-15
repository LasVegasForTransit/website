import type { APIRoute } from 'astro';
import { can } from '@lasvegasfortransit/platform-core/permissions';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import { confirmRosterSource } from '@lasvegasfortransit/platform-storage/roster-import-resolve';
import { field, fromSameOrigin } from '../../lib/forms';
import { messageResponse } from '../../lib/responses';

export const POST: APIRoute = async ({ request, locals }) => {
  const staff = locals.staff;
  if (!staff || !can(staff.actor, 'review_queue.resolve') || !fromSameOrigin(request))
    return messageResponse(t('staff.common.accessDenied'), 403);
  const form = await request.formData();
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: 'imports:resolve',
      token: field(form, 'token', 44),
    }))
  )
    return messageResponse(t('staff.imports.expired'), 409);
  const result = await confirmRosterSource(staff.db, staff.actor, {
    recordId: field(form, 'record_id', 201),
    personId: field(form, 'person_id', 201),
    personUpdatedAt: field(form, 'person_updated_at', 201),
    evidenceHash: field(form, 'evidence_hash', 201),
    operationId: field(form, 'operation_id', 201),
  });
  if (result.kind === 'forbidden') return messageResponse(t('staff.common.accessDenied'), 403);
  if (result.kind === 'stale') return messageResponse(t('staff.imports.stale'), 409);
  return new Response(null, { status: 303, headers: { Location: '/imports/?confirmed=1' } });
};
export const ALL: APIRoute = () => messageResponse('Use the signup confirmation form.', 405);
