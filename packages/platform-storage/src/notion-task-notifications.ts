import { taskPersonOrigins } from './notion-task-person-lineage';
import type { Db } from './db';
import type { TaskOperation } from './notion-task-operations';
import type { TaskEscalation } from './notion-task-escalations';
import { TASK_ESCALATION_AUTHORITY_SQL } from './notion-task-escalation-authority';
import type { TaskDigest } from './notion-task-digests';
import { TASK_CHECKIN_AUTHORITY_SQL } from './notion-task-authority';
import { TASK_RECIPIENT_AUTHORITY_SQL } from './notion-task-recipients';

/** Reserve immediately before a create-message effect. Ambiguous effects keep their reservation. */
export async function reserveTaskNotification(
  db: Db,
  input:
    | { kind: 'delivery'; operation: TaskOperation }
    | { kind: 'digest'; operation: TaskDigest }
    | { kind: 'escalation'; operation: TaskEscalation },
  now: Date,
): Promise<boolean> {
  const table =
    input.kind === 'delivery'
      ? 'task_checkin_operations'
      : input.kind === 'digest'
        ? 'task_checkin_digests'
        : 'task_checkin_escalations';
  const authority =
    input.kind === 'delivery'
      ? TASK_CHECKIN_AUTHORITY_SQL
      : input.kind === 'digest'
        ? TASK_RECIPIENT_AUTHORITY_SQL
        : TASK_ESCALATION_AUTHORITY_SQL;
  const stamp = now.toISOString();
  const result = await db
    .prepare(
      `
    INSERT INTO task_checkin_notifications(kind,operation_id,source_id,person_id,reserved_at)
    SELECT ?,o.id,o.source_id,o.person_id,? FROM ${table} o
    JOIN task_checkin_sources s ON s.id=o.source_id
    WHERE o.id=? AND o.state='processing' AND o.claim_token=? AND o.lease_expires_at>?
      ${input.kind === 'delivery' ? "AND o.kind='delivery'" : ''}
      AND ${authority}
      AND json_type(s.policy_json,'$.notificationLimit24h')='integer'
      AND json_extract(s.policy_json,'$.notificationLimit24h') BETWEEN 1 AND 20
      AND json_type(s.policy_json,'$.notificationGapMinutes')='integer'
      AND json_extract(s.policy_json,'$.notificationGapMinutes') BETWEEN 1 AND 1440
      AND (SELECT count(*) FROM task_checkin_notifications n
        WHERE n.source_id=o.source_id AND n.person_id IN (${taskPersonOrigins('o.person_id')}) AND n.reserved_at>?
        AND NOT(n.kind=? AND n.operation_id=o.id))<json_extract(s.policy_json,'$.notificationLimit24h')
      AND NOT EXISTS(SELECT 1 FROM task_checkin_notifications n
        WHERE n.source_id=o.source_id AND n.person_id IN (${taskPersonOrigins('o.person_id')})
        AND NOT(n.kind=? AND n.operation_id=o.id)
        AND julianday(n.reserved_at)>julianday(?)-json_extract(s.policy_json,'$.notificationGapMinutes')/1440.0)
    ON CONFLICT(kind,operation_id) DO UPDATE SET reserved_at=excluded.reserved_at
      WHERE task_checkin_notifications.source_id=excluded.source_id
        AND task_checkin_notifications.person_id=excluded.person_id`,
    )
    .bind(
      input.kind,
      stamp,
      input.operation.id,
      input.operation.claim_token,
      stamp,
      new Date(now.getTime() - 86_400_000).toISOString(),
      input.kind,
      input.kind,
      stamp,
    )
    .run();
  return result.meta.changes > 0;
}
