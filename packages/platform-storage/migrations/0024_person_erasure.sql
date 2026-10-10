-- A merge archive is reversible history, not an explicit deletion. Keep those
-- states separate so an erased snapshot can never be used to restore a profile.
ALTER TABLE people ADD COLUMN erased_at TEXT CHECK (erased_at IS NULL OR deleted_at IS NOT NULL);
ALTER TABLE merges ADD COLUMN erased_at TEXT;
CREATE INDEX merges_copy_history ON merges(merged_person_id,merged_at,unmerged_at);
CREATE TRIGGER erased_person_no_restore BEFORE UPDATE ON people
WHEN OLD.erased_at IS NOT NULL AND (
  NEW.erased_at IS NOT OLD.erased_at OR NEW.deleted_at IS NOT OLD.deleted_at
  OR NEW.given_name IS NOT NULL OR NEW.family_name IS NOT NULL OR NEW.email IS NOT NULL
  OR NEW.email_verified_at IS NOT NULL OR NEW.phone IS NOT NULL OR NEW.zip IS NOT NULL
  OR NEW.census_block IS NOT NULL OR NEW.census_block_vintage IS NOT NULL
  OR NEW.place_name IS NOT NULL OR NEW.region_id IS NOT NULL OR NEW.region_source IS NOT NULL
  OR NEW.region_set_at IS NOT NULL OR NEW.preferred_language<>'en')
BEGIN SELECT RAISE(ABORT,'erased personal data cannot be restored'); END;
CREATE TABLE person_erasure_scope (
  operation_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id),
  requested_at TEXT NOT NULL CHECK (julianday(requested_at) IS NOT NULL),
  PRIMARY KEY(operation_id,person_id)
);
-- Commit order distinguishes two actions in the same millisecond and survives
-- wall-clock changes. Existing receipts retain their original SQLite row order.
CREATE TABLE staff_operation_order (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL UNIQUE REFERENCES staff_operations(operation_id) ON DELETE CASCADE
);
INSERT INTO staff_operation_order(operation_id) SELECT operation_id FROM staff_operations ORDER BY rowid;
CREATE TRIGGER staff_operation_sequence AFTER INSERT ON staff_operations
BEGIN INSERT INTO staff_operation_order(operation_id) VALUES(NEW.operation_id); END;
CREATE TRIGGER staff_operation_order_no_update BEFORE UPDATE ON staff_operation_order
BEGIN SELECT RAISE(ABORT,'operation order cannot be changed'); END;
CREATE TRIGGER staff_operation_order_no_delete BEFORE DELETE ON staff_operation_order
WHEN EXISTS(SELECT 1 FROM staff_operations WHERE operation_id=OLD.operation_id)
BEGIN SELECT RAISE(ABORT,'operation order follows its receipt'); END;
CREATE VIEW merge_copy_intervals AS
SELECT m.id,m.merged_person_id,m.surviving_person_id,coalesce(start.sequence,0) AS first_order,
  CASE WHEN m.unmerged_at IS NULL THEN 9007199254740991 ELSE coalesce((
    SELECT min(finish.sequence) FROM staff_operation_order finish JOIN staff_operations op ON op.operation_id=finish.operation_id
    WHERE op.target_id=m.id AND op.kind='person.unmerge' AND op.applied_at IS NOT NULL),9007199254740991) END AS last_order
FROM merges m LEFT JOIN staff_operation_order start ON start.operation_id=m.operation_id;
CREATE TABLE person_erasure_copies (
  operation_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id),
  first_order INTEGER NOT NULL,
  last_order INTEGER NOT NULL,
  CHECK (first_order<=last_order),
  PRIMARY KEY(operation_id,person_id,first_order,last_order)
);
CREATE TRIGGER person_erasure_copies_no_update BEFORE UPDATE ON person_erasure_copies
BEGIN SELECT RAISE(ABORT,'erasure copies cannot be changed'); END;
CREATE TRIGGER person_erasure_scope_no_update BEFORE UPDATE ON person_erasure_scope
BEGIN SELECT RAISE(ABORT,'erasure scope cannot be changed'); END;

DROP TRIGGER merges_bookkeeping_immutable;
CREATE TRIGGER merges_bookkeeping_immutable BEFORE UPDATE ON merges
WHEN NEW.id IS NOT OLD.id OR NEW.surviving_person_id IS NOT OLD.surviving_person_id
  OR NEW.merged_person_id IS NOT OLD.merged_person_id OR NEW.merged_at IS NOT OLD.merged_at
  OR NEW.merged_by IS NOT OLD.merged_by OR NEW.created_at IS NOT OLD.created_at
  OR NEW.operation_id IS NOT OLD.operation_id
  OR NOT (
    (NEW.moved_rows IS OLD.moved_rows AND NEW.reason IS OLD.reason AND NEW.erased_at IS OLD.erased_at)
    OR (NEW.reason IS OLD.reason AND NEW.erased_at IS OLD.erased_at
      AND NEW.unmerged_at IS OLD.unmerged_at AND NEW.unmerged_by IS OLD.unmerged_by
      AND NEW.moved_rows=json_set(OLD.moved_rows,'$.reviews',(
        SELECT json_group_array(json(review.value)) FROM json_each(OLD.moved_rows,'$.reviews') review
        WHERE NOT EXISTS(SELECT 1 FROM person_erasure_scope s JOIN people p ON p.id=s.person_id
          WHERE p.deleted_at IS NOT NULL AND p.erased_at=s.requested_at
            AND s.person_id IN (json_extract(review.value,'$.candidate_person_id'),json_extract(review.value,'$.existing_person_id')))))
      AND EXISTS(SELECT 1 FROM json_each(OLD.moved_rows,'$.reviews') review JOIN person_erasure_scope s
        ON s.person_id IN (json_extract(review.value,'$.candidate_person_id'),json_extract(review.value,'$.existing_person_id'))
        JOIN people p ON p.id=s.person_id WHERE p.deleted_at IS NOT NULL AND p.erased_at=s.requested_at))
    OR (NEW.moved_rows='{}' AND NEW.reason IS NULL AND NEW.unmerged_at IS OLD.unmerged_at
      AND NEW.unmerged_by IS OLD.unmerged_by AND EXISTS (
        SELECT 1 FROM person_erasure_scope s JOIN people p ON p.id=s.person_id
        WHERE (s.person_id IN (OLD.surviving_person_id,OLD.merged_person_id)
            OR EXISTS(SELECT 1 FROM person_erasure_copies c WHERE c.operation_id=s.operation_id
              AND c.person_id=OLD.merged_person_id AND EXISTS(SELECT 1 FROM merge_copy_intervals h
                WHERE h.id=OLD.id AND h.first_order BETWEEN c.first_order AND c.last_order)))
          AND p.deleted_at IS NOT NULL AND p.erased_at=s.requested_at
          AND NEW.erased_at=coalesce(OLD.erased_at,s.requested_at)))
  )
BEGIN SELECT RAISE(ABORT,'merge bookkeeping cannot be changed'); END;

-- Keep the action, actor, target, time and receipt for the audit retention
-- period. Only its free-text details may be irreversibly redacted by erasure.
DROP TRIGGER staff_audit_append_only;
CREATE TRIGGER staff_audit_append_only BEFORE UPDATE ON staff_audits
WHEN NOT (
  NEW.id IS OLD.id AND NEW.actor_id IS OLD.actor_id AND NEW.action IS OLD.action
  AND NEW.permission IS OLD.permission AND NEW.target_id IS OLD.target_id
  AND NEW.operation_id IS OLD.operation_id AND NEW.occurred_at IS OLD.occurred_at
  AND NEW.details='{"personalDataErased":true}'
  AND EXISTS (SELECT 1 FROM person_erasure_scope s JOIN people p ON p.id=s.person_id
    WHERE p.deleted_at IS NOT NULL AND p.erased_at=s.requested_at
      AND (OLD.target_id=s.person_id
        OR EXISTS(SELECT 1 FROM merges m WHERE m.id=OLD.target_id
          AND (s.person_id IN (m.surviving_person_id,m.merged_person_id)
            OR EXISTS(SELECT 1 FROM person_erasure_copies c WHERE c.operation_id=s.operation_id
              AND c.person_id=m.merged_person_id AND EXISTS(SELECT 1 FROM merge_copy_intervals h
                WHERE h.id=m.id AND h.first_order BETWEEN c.first_order AND c.last_order))))
        OR EXISTS(SELECT 1 FROM person_corrections c WHERE c.operation_id=OLD.operation_id AND c.person_id=s.person_id)))
)
BEGIN SELECT RAISE(ABORT,'staff audits cannot be changed'); END;
