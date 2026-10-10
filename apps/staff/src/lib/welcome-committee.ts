import { CommitteeService } from '@lasvegasfortransit/platform-storage/committees';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { StaffContext } from './context';
import { field } from './forms';
import { messageResponse } from './responses';
export interface WelcomeCommitteeFeedback {
  message: string;
  committeeId: string;
  status: number;
}
export async function submitWelcomeCommittee(
  request: Request,
  staff: StaffContext,
  personId: string,
): Promise<Response | WelcomeCommitteeFeedback> {
  const form = await request.formData();
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: `welcome:committee:${personId}`,
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse('This form expired. Reload the welcome and try again.', 409);
  const committeeId = field(form, 'committee_id', 50);
  const operationId = field(form, 'operation_id', 201);
  if (!committeeId || !operationId || operationId.length > 200)
    return { message: 'Choose a committee from the list.', committeeId, status: 400 };
  const result = await new CommitteeService(staff.db).assign({
    personId,
    committeeId,
    role: 'member',
    actorId: staff.actor.personId,
    operationId,
    fromWelcome: true,
  });
  if (result.kind === 'ok')
    return new Response(null, {
      status: 303,
      headers: { Location: `/welcome/${personId}/#get-involved` },
    });
  if (result.kind === 'forbidden') return messageResponse("You don't have access to this", 403);
  return {
    message: 'This welcome or committee changed. Check the current details before trying again.',
    committeeId,
    status: 409,
  };
}
