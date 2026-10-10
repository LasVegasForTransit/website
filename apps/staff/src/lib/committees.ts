import {
  CommitteeService,
  type AssignmentRole,
  type AssignmentEndReason,
} from '@lasvegasfortransit/platform-storage/committees';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { StaffPerson } from '@lasvegasfortransit/platform-storage/staff-people';
import type { StaffContext } from './context';
import { field } from './forms';
import { messageResponse } from './responses';
import { rosterReturn } from './roster-return';
export interface CommitteeFeedback {
  message: string;
  committeeId: string;
  role: string;
  status: number;
}
function assignmentSaved(request: Request, personId: string, action: string): Response {
  const url = new URL(request.url);
  const returnTo = rosterReturn(url.searchParams.get('return_to'));
  const afterAssign = action === 'assign' && url.searchParams.get('return_after_assign') === '1';
  const returnQuery = returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : '';
  return new Response(null, {
    status: 303,
    headers: {
      Location:
        afterAssign && returnTo
          ? `${returnTo}#main`
          : `/people/${personId}/${returnQuery}#committees-heading`,
    },
  });
}
export async function submitCommittee(
  request: Request,
  staff: StaffContext,
  profile: StaffPerson,
): Promise<Response | CommitteeFeedback> {
  const form = await request.formData();
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: `person:committee:${profile.person.id}`,
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse(
      'This form expired or was already submitted. Reload the profile and try again.',
      409,
    );
  const action = field(form, 'action', 20);
  const committeeId = field(form, 'committee_id', 50);
  const role = field(form, 'role', 20);
  const operationId = field(form, 'operation_id', 201);
  const feedback = {
    message: 'Choose a committee and role from the list.',
    committeeId,
    role,
    status: 400,
  };
  if (!operationId || operationId.length > 200) return feedback;
  const service = new CommitteeService(staff.db);
  let result;
  if (action === 'assign') {
    if (profile.person.membership_status !== 'member')
      return messageResponse('Only current members can be added to a committee.', 409);
    result = await service.assign({
      personId: profile.person.id,
      committeeId,
      role: role as AssignmentRole,
      actorId: staff.actor.personId,
      operationId,
    });
  } else {
    const assignment = profile.assignments.find(
      (item) => item.id === field(form, 'assignment_id', 50) && !item.ended_at,
    );
    if (!assignment)
      return messageResponse('This assignment changed. Reload the profile and try again.', 409);
    if (action === 'change')
      result = await service.changeRole(
        assignment.id,
        role as AssignmentRole,
        staff.actor.personId,
        operationId,
      );
    else if (action === 'end')
      result = await service.endAssignment(
        assignment.id,
        field(form, 'reason', 50) as AssignmentEndReason,
        staff.actor.personId,
        operationId,
      );
    else return feedback;
  }
  if (result.kind === 'ok') return assignmentSaved(request, profile.person.id, action);
  if (result.kind === 'forbidden' || result.kind === 'not_found')
    return messageResponse("You don't have access to this", 403);
  return result.kind === 'invalid'
    ? feedback
    : {
        ...feedback,
        status: 409,
        message: 'This assignment changed. Check the current committees below before trying again.',
      };
}
