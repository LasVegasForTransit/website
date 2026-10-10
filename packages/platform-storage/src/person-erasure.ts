import type { Db, Statement } from './db';
const PEOPLE = '(SELECT person_id FROM person_erasure_scope WHERE operation_id=?)';
const MERGES = `(SELECT id FROM merges WHERE surviving_person_id IN ${PEOPLE} OR merged_person_id IN ${PEOPLE}
  OR EXISTS(SELECT 1 FROM person_erasure_copies c WHERE c.operation_id=?
    AND c.person_id=merges.merged_person_id AND EXISTS(SELECT 1 FROM merge_copy_intervals h
      WHERE h.id=merges.id AND h.first_order BETWEEN c.first_order AND c.last_order)))`;
const CORRECTIONS = `(SELECT operation_id FROM person_corrections WHERE person_id IN ${PEOPLE})`;
/** Resolve the current combination inside the deletion transaction, including chains. */
export function beginErasure(db: Db, id: string, operationId: string, stamp: string): Statement {
  return db
    .prepare(
      `INSERT INTO person_erasure_scope(operation_id,person_id,requested_at)
    WITH RECURSIVE affected(id) AS (
      SELECT id FROM people WHERE id=? AND erased_at IS NULL
      UNION SELECT CASE WHEN m.surviving_person_id=a.id THEN m.merged_person_id ELSE m.surviving_person_id END
      FROM merges m JOIN affected a ON a.id IN (m.surviving_person_id,m.merged_person_id)
      WHERE m.unmerged_at IS NULL AND m.erased_at IS NULL)
    SELECT ?,id,? FROM affected`,
    )
    .bind(id, operationId, stamp);
}
/** Follow only overlapping historical combinations that could carry a saved copy. */
export function beginErasureCopies(db: Db, operationId: string): Statement {
  return db
    .prepare(
      `INSERT INTO person_erasure_copies
    WITH RECURSIVE copied(operation_id,person_id,first_order,last_order) AS (
      SELECT operation_id,person_id,0,9007199254740991 FROM person_erasure_scope WHERE operation_id=?
      UNION SELECT c.operation_id,m.surviving_person_id,max(c.first_order,m.first_order),min(c.last_order,m.last_order)
      FROM merge_copy_intervals m JOIN copied c ON m.merged_person_id=c.person_id
      WHERE max(c.first_order,m.first_order)<=min(c.last_order,m.last_order))
    SELECT * FROM copied`,
    )
    .bind(operationId);
}
export function eraseHistory(db: Db, operationId: string, stamp: string): Statement[] {
  return [
    // A correction result includes the whole profile, including details copied
    // from a combination that may since have been undone. Its receipt must not
    // retain those copied values when their original owner requests erasure.
    db
      .prepare(
        `UPDATE staff_operations SET result=NULL WHERE kind='person.correct'
      AND EXISTS(SELECT 1 FROM person_erasure_copies c WHERE c.operation_id=?
        AND c.person_id=staff_operations.target_id AND EXISTS(SELECT 1 FROM staff_operation_order o
          WHERE o.operation_id=staff_operations.operation_id AND o.sequence BETWEEN c.first_order AND c.last_order))`,
      )
      .bind(operationId),
    db
      .prepare(
        `UPDATE staff_operations SET payload='{}',before_state=NULL,result=NULL
      WHERE target_id IN ${PEOPLE} OR target_id IN ${MERGES} OR operation_id IN ${CORRECTIONS}`,
      )
      .bind(operationId, operationId, operationId, operationId, operationId),
    db
      .prepare(
        `UPDATE staff_audits SET details='{"personalDataErased":true}'
      WHERE target_id IN ${PEOPLE} OR target_id IN ${MERGES} OR operation_id IN ${CORRECTIONS}`,
      )
      .bind(operationId, operationId, operationId, operationId, operationId),
    db
      .prepare(
        `UPDATE merges SET moved_rows='{}',reason=NULL,erased_at=coalesce(erased_at,?),updated_at=?
      WHERE id IN ${MERGES}`,
      )
      .bind(stamp, stamp, operationId, operationId, operationId),
    db
      .prepare(
        `UPDATE merges SET moved_rows=json_set(moved_rows,'$.reviews',(
        SELECT json_group_array(json(review.value)) FROM json_each(merges.moved_rows,'$.reviews') review
        WHERE NOT EXISTS(SELECT 1 FROM person_erasure_scope s WHERE s.operation_id=?
          AND s.person_id IN (json_extract(review.value,'$.candidate_person_id'),json_extract(review.value,'$.existing_person_id'))))),updated_at=?
      WHERE EXISTS(SELECT 1 FROM json_each(merges.moved_rows,'$.reviews') review JOIN person_erasure_scope s
        ON s.person_id IN (json_extract(review.value,'$.candidate_person_id'),json_extract(review.value,'$.existing_person_id'))
        WHERE s.operation_id=?)`,
      )
      .bind(operationId, stamp, operationId),
    ...['person_corrections', 'engagement_events', 'field_sources'].map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE person_id IN ${PEOPLE}`).bind(operationId),
    ),
    db
      .prepare(
        `DELETE FROM review_queue WHERE candidate_person_id IN ${PEOPLE} OR existing_person_id IN ${PEOPLE}`,
      )
      .bind(operationId, operationId),
  ];
}
export function eraseAccountProfiles(db: Db, operationId: string, stamp: string): Statement[] {
  const identities = `(SELECT id FROM identities WHERE person_id IN ${PEOPLE})`;
  const subjects = `(SELECT external_id FROM identities WHERE platform='google_workspace' AND person_id IN ${PEOPLE})`;
  return [
    db
      .prepare(
        `UPDATE identities SET external_email=NULL,updated_at=? WHERE person_id IN ${PEOPLE}`,
      )
      .bind(stamp, operationId),
    ...['discord_identity_profiles', 'discord_profiles'].map((table) =>
      db
        .prepare(`DELETE FROM ${table} WHERE identity_record_id IN ${identities}`)
        .bind(operationId),
    ),
    ...['workspace_pending_links', 'workspace_callback_tickets'].map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE workspace_subject IN ${subjects}`).bind(operationId),
    ),
    ...['access_observations', 'sessions', 'sign_in_codes', 'discord_link_states'].map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE person_id IN ${PEOPLE}`).bind(operationId),
    ),
    db.prepare(`DELETE FROM staff_form_tokens WHERE actor_id IN ${PEOPLE}`).bind(operationId),
    db
      .prepare(`DELETE FROM welcome_claims WHERE person_id IN ${PEOPLE} OR actor_id IN ${PEOPLE}`)
      .bind(operationId, operationId),
  ];
}
export function eraseProfile(db: Db, operationId: string, stamp: string): Statement {
  return db
    .prepare(
      `UPDATE people SET given_name=NULL,family_name=NULL,email=NULL,email_verified_at=NULL,phone=NULL,
    zip=NULL,census_block=NULL,census_block_vintage=NULL,place_name=NULL,region_id=NULL,region_source=NULL,region_set_at=NULL,
    preferred_language='en',deleted_at=coalesce(deleted_at,?),erased_at=?,updated_at=? WHERE id IN ${PEOPLE}`,
    )
    .bind(stamp, stamp, stamp, operationId);
}
