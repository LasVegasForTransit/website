import { t } from '@lasvegasfortransit/platform-core/messages';
import { leadCommitteeIds } from '@lasvegasfortransit/platform-core/permissions';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import {
  CommitteeApplicationService,
  NOTE_LIMIT,
  type StaffApplication,
} from '@lasvegasfortransit/platform-storage/committee-applications';
import type { StaffContext } from './context';
import { field } from './forms';
import { messageResponse } from './responses';

/** Administrators and committee leads decide applications. */
export function applicationsVisible(staff: StaffContext): boolean {
  return (
    staff.actor.membershipStatus === 'member' &&
    (staff.actor.staffAdmin || leadCommitteeIds(staff.actor).length > 0)
  );
}

export function applicantName(application: StaffApplication): string {
  return (
    [application.givenName, application.familyName].filter(Boolean).join(' ') || 'Name not recorded'
  );
}

/** "Events Coordinator · Events Committee" for a role, or the team for an ask to join. */
export function applicationTarget(application: StaffApplication): string {
  const committee = application.committeeName ?? t('staff.applications.noCommittee');
  return application.roleTitle
    ? t('staff.applications.roleTarget', { role: application.roleTitle, committee })
    : committee;
}

/** "Waiting 3 days", or "Sent today". */
export function applicationWaiting(application: StaffApplication): string {
  return application.waitingDays === 0
    ? t('staff.applications.waitingToday')
    : t('staff.applications.waitingFor', { count: application.waitingDays });
}

/** "Nov 20" in Las Vegas time. */
export function applicationDay(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'America/Los_Angeles',
      })
    : '';
}

/** "Accepted by Leon Staff · Nov 20", for a decided application. */
export function applicationDecision(application: StaffApplication): string {
  const by = application.decidedByName ?? '';
  const decision =
    application.state === 'accepted'
      ? t('staff.applications.accepted', { name: by })
      : application.state === 'declined'
        ? t('staff.applications.declined', { name: by })
        : t('staff.applications.withdrawn');
  return t('staff.applications.decidedOn', {
    decision,
    date: applicationDay(application.decidedAt),
  });
}

export async function applicationAction(
  request: Request,
  staff: StaffContext,
  id: string,
  kind: 'accept' | 'decline',
): Promise<Response> {
  const form = await request.formData();
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: `application:${kind}:${id}`,
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse(t('staff.applications.expired'), 409);
  const service = new CommitteeApplicationService(staff.db);
  const operationId = field(form, 'operation_id', 200) || ulid();
  const note = field(form, 'note', NOTE_LIMIT + 1);
  const outcome =
    kind === 'accept'
      ? await service.accept(staff.actor, id, {
          committeeId: field(form, 'committee_id', 100),
          operationId,
          note,
        })
      : await service.decline(staff.actor, id, { operationId, note });
  if (outcome.kind === 'forbidden' || outcome.kind === 'not_found')
    return messageResponse("You don't have access to this", 403);
  if (outcome.kind === 'invalid') return messageResponse(t('staff.applications.invalid'), 400);
  if (outcome.kind !== 'ok') return messageResponse(t('staff.applications.changed'), 409);
  return new Response(null, { status: 303, headers: { Location: `/applications/${id}/` } });
}
