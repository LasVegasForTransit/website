import type { Db, Statement } from './db';
import {
  beginErasureCopies,
  eraseProfile,
  eraseHistory,
  eraseAccountProfiles,
} from './person-erasure';
interface RetentionRun {
  operationId: string;
  stamp: string;
  deletedBefore: string;
  limit: number;
}
/** Backfill ordinary deletions without treating a reversible archive as deletion. */
function legacyErasure(db: Db, run: RetentionRun): Statement {
  return db
    .prepare(
      `INSERT INTO person_erasure_scope(operation_id,person_id,requested_at)
    WITH RECURSIVE seeds(id) AS (
      SELECT p.id FROM people p WHERE p.deleted_at IS NOT NULL AND p.erased_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM merges m WHERE m.merged_person_id=p.id
          AND m.unmerged_at IS NULL AND m.erased_at IS NULL AND m.merged_at=p.deleted_at)
      ORDER BY p.deleted_at,p.id LIMIT ?), affected(id) AS (
      SELECT id FROM seeds
      UNION SELECT CASE WHEN m.surviving_person_id=a.id THEN m.merged_person_id ELSE m.surviving_person_id END
        FROM merges m JOIN affected a ON a.id IN (m.surviving_person_id,m.merged_person_id)
        WHERE m.unmerged_at IS NULL AND m.erased_at IS NULL)
    SELECT ?,id,? FROM affected`,
    )
    .bind(run.limit, run.operationId, run.stamp);
}
function purgeScope(db: Db, run: RetentionRun): Statement {
  return db
    .prepare(
      `INSERT INTO person_retention_scope(operation_id,person_id,run_at,deleted_before)
    SELECT ?,p.id,?,? FROM people p WHERE p.deleted_at<? AND p.erased_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM merges m WHERE m.merged_person_id=p.id
        AND m.unmerged_at IS NULL AND m.erased_at IS NULL)
    ORDER BY p.deleted_at,p.id LIMIT ?`,
    )
    .bind(run.operationId, run.stamp, run.deletedBefore, run.deletedBefore, run.limit);
}
/** Remove any copies written by older code after its original erasure. */
function purgePersonalCopies(db: Db, run: RetentionRun): Statement[] {
  const people = '(SELECT person_id FROM person_retention_scope WHERE operation_id=?)';
  const identities = `(SELECT id FROM identities WHERE person_id IN ${people})`;
  const subjects = `(SELECT external_id FROM identities WHERE platform='google_workspace' AND person_id IN ${people})`;
  return [
    ...[
      'consent_records',
      'consent_withdrawals',
      'form_submissions',
      'workspace_link_operations',
      'committee_assignments',
      'staff_administrators',
      'person_corrections',
      'engagement_events',
      'field_sources',
      'sign_in_codes',
      'sessions',
      'discord_link_states',
      'access_observations',
    ].map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE person_id IN ${people}`).bind(run.operationId),
    ),
    db
      .prepare(
        `DELETE FROM review_queue WHERE candidate_person_id IN ${people} OR existing_person_id IN ${people}`,
      )
      .bind(run.operationId, run.operationId),
    db.prepare(`DELETE FROM staff_form_tokens WHERE actor_id IN ${people}`).bind(run.operationId),
    db
      .prepare(`DELETE FROM welcome_claims WHERE person_id IN ${people} OR actor_id IN ${people}`)
      .bind(run.operationId, run.operationId),
    db
      .prepare(
        `UPDATE identities SET external_email=NULL,updated_at=? WHERE person_id IN ${people}`,
      )
      .bind(run.stamp, run.operationId),
    ...['discord_profiles', 'discord_identity_profiles'].map((table) =>
      db
        .prepare(`DELETE FROM ${table} WHERE identity_record_id IN ${identities}`)
        .bind(run.operationId),
    ),
    ...['workspace_pending_links', 'workspace_callback_tickets'].map((table) =>
      db
        .prepare(`DELETE FROM ${table} WHERE workspace_subject IN ${subjects}`)
        .bind(run.operationId),
    ),
  ];
}
/** All selection, redaction and physical cleanup share the maintenance transaction. */
export function personRetentionWrites(db: Db, run: RetentionRun): Statement[] {
  const people = '(SELECT person_id FROM person_retention_scope WHERE operation_id=?)';
  return [
    legacyErasure(db, run),
    db
      .prepare('SELECT count(*) AS profiles_erased FROM person_erasure_scope WHERE operation_id=?')
      .bind(run.operationId),
    eraseProfile(db, run.operationId, run.stamp),
    beginErasureCopies(db, run.operationId),
    ...eraseHistory(db, run.operationId, run.stamp),
    ...eraseAccountProfiles(db, run.operationId, run.stamp),
    db.prepare('DELETE FROM person_erasure_copies WHERE operation_id=?').bind(run.operationId),
    db.prepare('DELETE FROM person_erasure_scope WHERE operation_id=?').bind(run.operationId),
    purgeScope(db, run),
    ...purgePersonalCopies(db, run),
    db.prepare(`DELETE FROM people WHERE id IN ${people}`).bind(run.operationId),
    db.prepare('DELETE FROM person_retention_scope WHERE operation_id=?').bind(run.operationId),
  ];
}
