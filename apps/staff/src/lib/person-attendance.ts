import { can } from '@lasvegasfortransit/platform-core/permissions';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import {
  recordPersonAttendance,
  type PersonAttendanceInput,
  type AttendanceErrors,
} from '@lasvegasfortransit/platform-storage/person-attendance';
import type { StaffContext } from './context';
import { field, fromSameOrigin } from './forms';
import { messageResponse } from './responses';
import { rosterReturn } from './roster-return';

export interface AttendanceFeedback {
  input: PersonAttendanceInput;
  status: number;
  message: string;
  errors: Partial<Record<'eventName' | 'eventDate', string>>;
}
export const attendanceTokenAction = (personId: string) => `person:attendance:${personId}`;
function attendanceErrors(input: AttendanceErrors): AttendanceFeedback['errors'] {
  const errors: AttendanceFeedback['errors'] = {};
  if (input.eventName) errors.eventName = t('staff.participation.nameError');
  if (input.eventDate)
    errors.eventDate =
      input.eventDate === 'future'
        ? t('staff.participation.futureError')
        : t('staff.participation.dateError');
  return errors;
}

export async function submitPersonAttendance(
  request: Request,
  staff: StaffContext,
  personId: string,
): Promise<Response | AttendanceFeedback> {
  if (
    request.method !== 'POST' ||
    !fromSameOrigin(request) ||
    !can(staff.actor, 'attendance.record')
  )
    return messageResponse(t('staff.common.accessDenied'), 403);
  const form = await request.formData();
  const input = {
    personId,
    eventName: field(form, 'event_name', 161),
    eventDate: field(form, 'event_date', 30),
    operationId: field(form, 'operation_id', 201),
  };
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: attendanceTokenAction(personId),
      token: field(form, 'token', 43),
    }))
  )
    return { input, status: 409, errors: {}, message: t('staff.participation.expired') };
  try {
    const result = await recordPersonAttendance(staff.db, staff.actor, input);
    if (result.kind === 'forbidden') return messageResponse(t('staff.common.accessDenied'), 403);
    if (result.kind === 'ok') {
      const returnTo = rosterReturn(new URL(request.url).searchParams.get('return_to'));
      return new Response(null, {
        status: 303,
        headers: {
          Location: `/people/${personId}/${returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : ''}#participation-heading`,
        },
      });
    }
    return {
      input,
      status: result.kind === 'invalid' ? 400 : 409,
      errors: result.kind === 'invalid' ? attendanceErrors(result.errors) : {},
      message:
        result.kind === 'invalid'
          ? t('staff.participation.invalid')
          : t('staff.participation.conflict'),
    };
  } catch {
    return { input, status: 503, errors: {}, message: t('staff.participation.unavailable') };
  }
}
