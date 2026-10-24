-- Scalar subqueries can lose SQLite's JSON subtype. Preserve review arrays
-- explicitly at json_set, and repair archives written with a quoted array.
DROP TRIGGER merges_bookkeeping_immutable;

UPDATE merges SET moved_rows=json_set(moved_rows,'$.reviews',json(json_extract(moved_rows,'$.reviews')))
WHERE json_type(moved_rows,'$.reviews')='text'
  AND CASE WHEN json_valid(json_extract(moved_rows,'$.reviews'))
    THEN json_type(json_extract(moved_rows,'$.reviews'))='array' ELSE 0 END;

CREATE TRIGGER merges_bookkeeping_immutable BEFORE UPDATE ON merges
WHEN NEW.id IS NOT OLD.id OR NEW.surviving_person_id IS NOT OLD.surviving_person_id
  OR NEW.merged_person_id IS NOT OLD.merged_person_id OR NEW.merged_at IS NOT OLD.merged_at
  OR NEW.merged_by IS NOT OLD.merged_by OR NEW.created_at IS NOT OLD.created_at
  OR NEW.operation_id IS NOT OLD.operation_id
  OR NOT (
    (NEW.moved_rows IS OLD.moved_rows AND NEW.reason IS OLD.reason AND NEW.erased_at IS OLD.erased_at)
    OR (NEW.reason IS OLD.reason AND NEW.erased_at IS OLD.erased_at
      AND NEW.unmerged_at IS OLD.unmerged_at AND NEW.unmerged_by IS OLD.unmerged_by
      AND NEW.moved_rows=json_set(OLD.moved_rows,'$.reviews',json((
        SELECT json_group_array(json(review.value)) FROM json_each(OLD.moved_rows,'$.reviews') review
        WHERE NOT EXISTS(SELECT 1 FROM person_erasure_scope s JOIN people p ON p.id=s.person_id
          WHERE p.deleted_at IS NOT NULL AND p.erased_at=s.requested_at
            AND s.person_id IN (json_extract(review.value,'$.candidate_person_id'),json_extract(review.value,'$.existing_person_id'))))))
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
