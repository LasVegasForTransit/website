import type { Db, Statement } from './db';
import { taskPersonCanonical, taskPersonOrigins } from './notion-task-person-lineage';
function affected(person: string) {
  return `EXISTS(SELECT 1 FROM json_each(?) affected LEFT JOIN people canonical
    ON canonical.id=(${taskPersonCanonical('affected.value')})
    WHERE ${person}=affected.value OR ${person} IN (${taskPersonOrigins('canonical.id')}))`;
}
/** A workspace mapping is shared by all its sources; revoke every affected live/merged choice. */
export function mappingCorrectionWrites(
  db: Db,
  input: { sourceId: string; auditId: string; personIds: string[]; stamp: string },
): Statement[] {
  const scope = `EXISTS(SELECT 1 FROM staff_audits WHERE id=?) AND EXISTS(SELECT 1 FROM task_checkin_sources s
    JOIN task_checkin_sources selected ON selected.workspace_id=s.workspace_id WHERE s.id=c.source_id AND selected.id=?)`;
  const people = JSON.stringify(input.personIds),
    values = [input.auditId, input.sourceId, people];
  return [
    db
      .prepare(
        `UPDATE task_checkin_consents AS c SET state=CASE WHEN state='opted_out' THEN 'opted_out' ELSE 'paused' END,
      revision=revision+1,updated_at=? WHERE ${scope} AND ${affected('c.person_id')}`,
      )
      .bind(input.stamp, ...values),
    db
      .prepare(`DELETE FROM task_checkin_cards AS c WHERE ${scope} AND ${affected('c.person_id')}`)
      .bind(...values),
    db
      .prepare(
        `UPDATE task_checkin_escalations AS c SET state='superseded',reason='mapping_changed',updated_at=?
      WHERE state IN ('queued','retryable','review') AND ${scope}
      AND (${affected('c.subject_id')} OR ${affected('c.person_id')})`,
      )
      .bind(input.stamp, ...values, people),
  ];
}
