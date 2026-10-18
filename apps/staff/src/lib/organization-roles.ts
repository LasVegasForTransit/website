import { can } from '@lasvegasfortransit/platform-core/permissions';
import { t } from '@lasvegasfortransit/platform-core/messages';
import {
  defineOrganizationRole,
  renameOrganizationRole,
  retireOrganizationRole,
  assignOrganizationRole,
  removeOrganizationRole,
} from '@lasvegasfortransit/platform-storage/organization-roles';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { StaffContext } from './context';
import { field, fromSameOrigin } from './forms';
import { messageResponse } from './responses';
import { rosterReturn } from './roster-return';
export interface RoleFeedback {
  message: string;
  status: number;
  name?: string;
}
export type CatalogRoleAction = 'define' | 'rename' | 'retire';
export function roleTokenAction(action: CatalogRoleAction, roleId = 'catalog') {
  return `organization-role:${action}:${roleId}`;
}
export function personRoleTokenAction(personId: string) {
  return `person:organization-role:${personId}`;
}
function refused(request: Request, staff: StaffContext): Response | null {
  return request.method !== 'POST' || !fromSameOrigin(request) || !can(staff.actor, 'person.update')
    ? messageResponse(t('staff.common.accessDenied'), 403)
    : null;
}
function resultFeedback(kind: string, assignment = false): Response | RoleFeedback {
  if (kind === 'forbidden' || kind === 'not_found')
    return messageResponse(t('staff.common.accessDenied'), 403);
  return {
    status: kind === 'invalid' ? 400 : 409,
    message: assignment
      ? t('staff.organizationRoles.assignmentConflict')
      : kind === 'invalid'
        ? t('staff.organizationRoles.invalid')
        : t('staff.organizationRoles.conflict'),
  };
}
export async function submitOrganizationRole(
  request: Request,
  staff: StaffContext,
  action: CatalogRoleAction,
  roleId?: string,
): Promise<Response | RoleFeedback> {
  const denied = refused(request, staff);
  if (denied) return denied;
  const form = await request.formData();
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: roleTokenAction(action, roleId),
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse(t('staff.organizationRoles.unavailable'), 409);
  const name = field(form, 'name', 101),
    operationId = field(form, 'operation_id', 201);
  const input = { roleId: roleId ?? '', name, operationId };
  const result =
    action === 'define'
      ? await defineOrganizationRole(staff.db, staff.actor, input)
      : action === 'rename'
        ? await renameOrganizationRole(staff.db, staff.actor, input)
        : await retireOrganizationRole(staff.db, staff.actor, input);
  if (result.kind === 'ok')
    return new Response(null, { status: 303, headers: { Location: '/roles/' } });
  const feedback = resultFeedback(result.kind);
  return feedback instanceof Response ? feedback : { ...feedback, name };
}
export async function submitPersonRole(
  request: Request,
  staff: StaffContext,
  personId: string,
): Promise<Response | RoleFeedback> {
  const denied = refused(request, staff);
  if (denied) return denied;
  const form = await request.formData();
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: personRoleTokenAction(personId),
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse(t('staff.organizationRoles.unavailable'), 409);
  const action = field(form, 'role_action', 20);
  if (!['assign', 'remove'].includes(action)) return resultFeedback('invalid', true);
  const input = {
    personId,
    roleId: field(form, 'role_id', 100),
    operationId: field(form, 'operation_id', 201),
  };
  const result =
    action === 'assign'
      ? await assignOrganizationRole(staff.db, staff.actor, input)
      : await removeOrganizationRole(staff.db, staff.actor, input);
  if (result.kind !== 'ok') return resultFeedback(result.kind, true);
  const returnTo = rosterReturn(new URL(request.url).searchParams.get('return_to'));
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/people/${personId}/${returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : ''}#roles-heading`,
    },
  });
}
