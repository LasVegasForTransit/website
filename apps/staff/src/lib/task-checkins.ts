import {
  retryTaskDeliveryIssue,
  closeTaskDeliveryIssue,
} from '@lasvegasfortransit/platform-storage/notion-task-delivery-admin';
import { resolveTaskEscalation } from '@lasvegasfortransit/platform-storage/notion-task-escalation-admin';
import { correctTaskCheckinMapping } from '@lasvegasfortransit/platform-storage/notion-task-mapping-admin';
import {
  requestTaskCommentRecovery,
  closeHeldTaskUpdate,
} from '@lasvegasfortransit/platform-storage/notion-task-recovery';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import {
  requireTaskCheckinAdmin,
  confirmTaskCheckinMapping,
  retryTaskCheckinOperation,
} from '@lasvegasfortransit/platform-storage/notion-task-admin';
import { configureTaskCheckins } from '@lasvegasfortransit/platform-integrations/notion-task-admin';
import type { StaffContext } from './context';
import { field, fromSameOrigin } from './forms';
import { taskPolicyFromForm } from './task-checkin-form';
import { messageResponse } from './responses';
export interface TaskCheckinFeedback {
  status: number;
  message: string;
  gaps?: string[];
  policy?: Record<string, unknown>;
  workspaceId?: string;
  sourceId?: string;
}
export async function submitTaskCheckinForm(
  request: Request,
  staff: StaffContext,
  sourceId: string,
): Promise<Response | TaskCheckinFeedback> {
  if (!fromSameOrigin(request)) return messageResponse(t('staff.common.accessDenied'), 403);
  const form = await request.formData(),
    action = field(form, 'action', 20);
  if (
    ![
      'aux_retry',
      'aux_close',
      'configure',
      'mapping',
      'mapping_change',
      'mapping_remove',
      'retry',
      'reconcile',
      'close',
      'escalation_retry',
      'escalation_close',
    ].includes(action)
  )
    return messageResponse(t('taskCheckins.staff.invalidForm'), 400);
  const target = sourceId || field(form, 'sourceId', 200).trim().toLowerCase();
  try {
    await requireTaskCheckinAdmin(staff.db, staff.actor);
    if (
      !(await consumeFormToken(staff.db, staff.actor, {
        action: `task-checkins:${sourceId || 'new'}:${action}`,
        token: field(form, 'token', 43),
      }))
    )
      return messageResponse(t('taskCheckins.staff.expiredForm'), 409);
    const result = await applyForm(staff, form, { sourceId: target, action });
    if (result) return result;
    return {
      status: 409,
      message: action.startsWith('mapping')
        ? t('taskCheckins.staff.mappingConflict')
        : t('taskCheckins.staff.recordChanged'),
    };
  } catch (error) {
    if (error instanceof PermissionDenied) return messageResponse(error.message, 403);
    throw error;
  }
}
async function applyForm(
  staff: StaffContext,
  form: FormData,
  input: { sourceId: string; action: string },
): Promise<Response | TaskCheckinFeedback | null> {
  const { sourceId, action } = input,
    now = new Date(),
    expectedRevision = Number(field(form, 'expectedRevision', 12));
  if (action === 'aux_retry' || action === 'aux_close')
    return deliveryForm(staff, form, { sourceId, action }, now);
  if (action === 'configure') {
    const policy = taskPolicyFromForm(form),
      workspaceId = field(form, 'workspaceId', 200).trim();
    const result = await configureTaskCheckins(
      staff.db,
      staff.actor,
      { sourceId, workspaceId, expectedRevision, enabled: form.get('enabled') === 'on', policy },
      now,
    );
    if (result.kind === 'invalid')
      return {
        status: 422,
        message: t('taskCheckins.staff.incomplete'),
        gaps: result.gaps,
        policy,
        workspaceId,
        sourceId,
      };
    if (result.kind !== 'ok') return null;
  } else if (!(await applyTaskRecoveryForm(staff, form, sourceId))) return null;
  return new Response(null, {
    status: 303,
    headers: { Location: `/task-checkins/?source=${encodeURIComponent(sourceId)}&saved=1` },
  });
}

async function applyTaskRecoveryForm(
  staff: StaffContext,
  form: FormData,
  sourceId: string,
): Promise<boolean> {
  const action = field(form, 'action', 20),
    now = new Date();
  if (action === 'mapping' || action === 'mapping_change' || action === 'mapping_remove') {
    const notionUserId = field(form, 'notionUserId', 200).trim(),
      personId = field(form, 'personId', 200).trim();
    if (!notionUserId || (action !== 'mapping_remove' && !personId)) return false;
    if (action !== 'mapping')
      return correctTaskCheckinMapping(
        staff.db,
        staff.actor,
        {
          sourceId,
          expectedRevision: Number(field(form, 'expectedRevision', 12)),
          notionUserId,
          expectedVersion: field(form, 'expectedVersion', 32),
          expectedPersonId: field(form, 'expectedPersonId', 200),
          personId: action === 'mapping_remove' ? null : personId,
        },
        now,
      );
    return confirmTaskCheckinMapping(
      staff.db,
      staff.actor,
      {
        sourceId,
        expectedRevision: Number(field(form, 'expectedRevision', 12)),
        notionUserId,
        personId,
      },
      now,
    );
  }
  const input = {
    sourceId,
    operationId: field(form, 'operationId', 200),
    expectedUpdatedAt: field(form, 'expectedUpdatedAt', 40),
  };
  if (action === 'escalation_retry' || action === 'escalation_close')
    return resolveTaskEscalation(
      staff.db,
      staff.actor,
      { ...input, action: action === 'escalation_retry' ? 'retry' : 'close' },
      now,
    );
  if (action === 'retry') return retryTaskCheckinOperation(staff.db, staff.actor, input, now);
  if (action === 'reconcile') return requestTaskCommentRecovery(staff.db, staff.actor, input, now);
  return closeHeldTaskUpdate(staff.db, staff.actor, input, now);
}

async function deliveryForm(
  staff: StaffContext,
  form: FormData,
  input: { sourceId: string; action: string },
  now: Date,
): Promise<Response | TaskCheckinFeedback | null> {
  const { sourceId, action } = input;
  const kind = field(form, 'auxKind', 12);
  if (kind !== 'digest' && kind !== 'refresh')
    return messageResponse(t('taskCheckins.staff.invalidForm'), 400);
  const generation = field(form, 'expectedGeneration', 12);
  const deliveryInput = {
    sourceId,
    kind,
    id: field(form, 'operationId', 500),
    expectedUpdatedAt: field(form, 'expectedUpdatedAt', 40),
    expectedGeneration: generation ? Number(generation) : null,
  } satisfies Parameters<typeof retryTaskDeliveryIssue>[2];
  const changed =
    action === 'aux_retry'
      ? await retryTaskDeliveryIssue(staff.db, staff.actor, deliveryInput, now)
      : await closeTaskDeliveryIssue(staff.db, staff.actor, deliveryInput, now);
  return changed
    ? {
        status: 200,
        message:
          action === 'aux_retry' ? 'A safe retry is queued.' : 'Closed without another send.',
      }
    : null;
}
