import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db, Statement } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
export interface ReviewDecision {
  id: string;
  actorId: string;
  operationId: string;
  payload: string;
  stamp: string;
  candidateId: string;
  existingId: string;
  note: string;
}
const FRESH = `EXISTS(SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND kind='review.keep_separate' AND target_id=? AND payload=? AND applied_at IS NULL)`;
function fresh(input: ReviewDecision) {
  return [input.operationId, input.actorId, input.id, input.payload];
}
function decisionEvents(db: Db, input: ReviewDecision): Statement[] {
  return [input.candidateId, input.existingId].map((personId) =>
    db
      .prepare(
        `INSERT INTO engagement_events(id,person_id,type,occurred_at,source,reference,details,created_at)
    SELECT ?,?,'duplicate_reviewed',?,'staff',?,?,? WHERE ${FRESH}`,
      )
      .bind(
        ulid(),
        personId,
        input.stamp,
        input.id,
        JSON.stringify({ actorId: input.actorId, resolution: 'kept_separate', note: input.note }),
        input.stamp,
        ...fresh(input),
      ),
  );
}
export function keepSeparateWrites(db: Db, input: ReviewDecision): Statement[] {
  return [
    db
      .prepare(
        `INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,created_at)
      SELECT ?,?,'review.keep_separate',?,?,? FROM review_queue q
      JOIN people a ON a.id=q.candidate_person_id AND a.deleted_at IS NULL JOIN people b ON b.id=q.existing_person_id AND b.deleted_at IS NULL
      WHERE q.id=? AND q.candidate_person_id=? AND q.existing_person_id=? AND q.resolved_at IS NULL AND ${STAFF_ADMIN_SCOPE} ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(
        input.operationId,
        input.actorId,
        input.id,
        input.payload,
        input.stamp,
        input.id,
        input.candidateId,
        input.existingId,
        input.actorId,
      ),
    db
      .prepare(
        `UPDATE review_queue SET resolution='kept_separate',resolved_by=?,resolved_at=?,updated_at=?
      WHERE resolved_at IS NULL AND ((candidate_person_id=? AND existing_person_id=?) OR (candidate_person_id=? AND existing_person_id=?)) AND ${FRESH}`,
      )
      .bind(
        input.actorId,
        input.stamp,
        input.stamp,
        input.candidateId,
        input.existingId,
        input.existingId,
        input.candidateId,
        ...fresh(input),
      ),
    ...decisionEvents(db, input),
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at)
      SELECT ?,?,'review.keep_separate',?,?,?,? WHERE ${FRESH}`,
      )
      .bind(
        ulid(),
        input.actorId,
        input.id,
        input.payload,
        input.operationId,
        input.stamp,
        ...fresh(input),
      ),
    db
      .prepare(
        `UPDATE staff_operations SET applied_at=?,result=? WHERE operation_id=? AND ${FRESH}`,
      )
      .bind(
        input.stamp,
        JSON.stringify({ reviewId: input.id }),
        input.operationId,
        ...fresh(input),
      ),
  ];
}
