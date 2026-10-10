import type { PersonFields } from '@lasvegasfortransit/platform-storage/person-service';
import { correctPerson } from '@lasvegasfortransit/platform-storage/corrections';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { StaffContext } from './context';
import { field } from './forms';
import { messageResponse } from './responses';
import { rosterReturn } from './roster-return';
export const EDIT_FIELDS = [
  { name: 'given_name', label: 'First name', limit: 128, type: 'text' },
  { name: 'family_name', label: 'Last name', limit: 128, type: 'text' },
  { name: 'email', label: 'Email', limit: 254, type: 'email' },
  { name: 'phone', label: 'Phone', limit: 50, type: 'tel' },
  { name: 'zip', label: 'ZIP code', limit: 5, type: 'text' },
] as const;
export interface CorrectionFeedback {
  fields: PersonFields;
  reason: string;
  expectedUpdatedAt: string;
  message: string;
  status: number;
}
export async function submitCorrection(
  request: Request,
  staff: StaffContext,
  personId: string,
): Promise<Response | CorrectionFeedback> {
  const form = await request.formData();
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: `person:correct:${personId}`,
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse(
      'This form expired or was already submitted. Reload the profile and try again.',
      409,
    );
  const fields: PersonFields = Object.fromEntries(
    EDIT_FIELDS.map((item) => [item.name, field(form, item.name, item.limit + 1)]),
  );
  fields.preferred_language = field(form, 'preferred_language', 36);
  const reason = field(form, 'reason', 2001);
  const expectedUpdatedAt = field(form, 'expected_updated_at', 50);
  const outcome = await correctPerson(staff.db, staff.actor, personId, {
    fields,
    reason,
    expectedUpdatedAt,
    operationId: field(form, 'operation_id', 201),
  });
  if (outcome.kind === 'ok') {
    const returnTo = rosterReturn(new URL(request.url).searchParams.get('return_to'));
    const returnQuery = returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : '';
    return new Response(null, {
      status: 303,
      headers: { Location: `/people/${personId}/${returnQuery}#history-heading` },
    });
  }
  if (outcome.kind === 'forbidden' || outcome.kind === 'not_found')
    return messageResponse("You don't have access to this", 403);
  return {
    fields,
    reason,
    expectedUpdatedAt,
    status: outcome.kind === 'invalid' ? 400 : 409,
    message:
      outcome.kind === 'invalid'
        ? 'Change at least one field, enter a reason, and check the contact details.'
        : 'These changes could not be saved. Reload the profile and check that the email belongs to this member.',
  };
}
