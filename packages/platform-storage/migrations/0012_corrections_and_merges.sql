-- Staff corrections preserve prior values and their source, with an attributed reason.
CREATE TABLE person_corrections (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  actor_id TEXT NOT NULL REFERENCES people(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  changes TEXT NOT NULL CHECK (json_valid(changes) AND json_type(changes)='array'),
  operation_id TEXT NOT NULL UNIQUE,
  corrected_at TEXT NOT NULL
);
CREATE INDEX person_corrections_person ON person_corrections(person_id,corrected_at);
CREATE TRIGGER person_corrections_append_only BEFORE UPDATE ON person_corrections
BEGIN SELECT RAISE(ABORT,'person corrections cannot be changed'); END;


-- Every withdrawal request is evidence, even when no active consent remains.
CREATE TABLE consent_withdrawals (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  origin_person_id TEXT NOT NULL REFERENCES people(id),
  scope TEXT NOT NULL CHECK (scope IN ('newsletter','event_reminders','volunteer_contact')),
  source TEXT NOT NULL,
  withdrawn_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE UNIQUE INDEX consent_withdrawal_request ON consent_withdrawals(origin_person_id,scope,source,withdrawn_at);
ALTER TABLE merges ADD COLUMN operation_id TEXT;
ALTER TABLE merges ADD COLUMN reason TEXT;
CREATE UNIQUE INDEX merge_operation ON merges(operation_id) WHERE operation_id IS NOT NULL;
CREATE UNIQUE INDEX person_one_active_merge ON merges(merged_person_id) WHERE unmerged_at IS NULL;

DROP TRIGGER engagement_events_append_only;
CREATE TRIGGER engagement_events_append_only BEFORE UPDATE ON engagement_events
WHEN NOT (
  NEW.id IS OLD.id AND NEW.type IS OLD.type AND NEW.occurred_at IS OLD.occurred_at AND NEW.source IS OLD.source AND NEW.reference IS OLD.reference AND NEW.details IS OLD.details AND NEW.created_at IS OLD.created_at
  AND EXISTS (SELECT 1 FROM merges m JOIN staff_operations op ON op.target_id=m.id
    JOIN json_each(m.moved_rows,'$.rows') movement
    WHERE m.unmerged_at IS NULL AND op.applied_at IS NULL
      AND json_extract(movement.value,'$.table')='engagement_events'
      AND json_extract(movement.value,'$.key')=OLD.id
      AND ((op.kind='person.merge' AND op.operation_id=m.operation_id AND OLD.person_id=m.merged_person_id AND NEW.person_id=m.surviving_person_id)
        OR (op.kind='person.unmerge' AND OLD.person_id=m.surviving_person_id AND NEW.person_id=m.merged_person_id)))
)
BEGIN SELECT RAISE(ABORT,'engagement events cannot be changed'); END;

DROP TRIGGER person_corrections_append_only;
CREATE TRIGGER person_corrections_append_only BEFORE UPDATE ON person_corrections
WHEN NOT (
  NEW.id IS OLD.id AND NEW.actor_id IS OLD.actor_id AND NEW.reason IS OLD.reason AND NEW.changes IS OLD.changes AND NEW.operation_id IS OLD.operation_id AND NEW.corrected_at IS OLD.corrected_at
  AND EXISTS (SELECT 1 FROM merges m JOIN staff_operations op ON op.target_id=m.id
    JOIN json_each(m.moved_rows,'$.rows') movement
    WHERE m.unmerged_at IS NULL AND op.applied_at IS NULL
      AND json_extract(movement.value,'$.table')='person_corrections'
      AND json_extract(movement.value,'$.key')=OLD.id
      AND ((op.kind='person.merge' AND op.operation_id=m.operation_id AND OLD.person_id=m.merged_person_id AND NEW.person_id=m.surviving_person_id)
        OR (op.kind='person.unmerge' AND OLD.person_id=m.surviving_person_id AND NEW.person_id=m.merged_person_id)))
)
BEGIN SELECT RAISE(ABORT,'person corrections cannot be changed'); END;
CREATE TRIGGER consent_withdrawals_append_only BEFORE UPDATE ON consent_withdrawals
WHEN NOT (
  NEW.id IS OLD.id AND NEW.origin_person_id IS OLD.origin_person_id AND NEW.scope IS OLD.scope AND NEW.source IS OLD.source AND NEW.withdrawn_at IS OLD.withdrawn_at AND NEW.recorded_at IS OLD.recorded_at
  AND EXISTS (SELECT 1 FROM merges m JOIN staff_operations op ON op.target_id=m.id
    JOIN json_each(m.moved_rows,'$.rows') movement
    WHERE m.unmerged_at IS NULL AND op.applied_at IS NULL
      AND json_extract(movement.value,'$.table')='consent_withdrawals'
      AND json_extract(movement.value,'$.key')=OLD.id
      AND ((op.kind='person.merge' AND op.operation_id=m.operation_id AND OLD.person_id=m.merged_person_id AND NEW.person_id=m.surviving_person_id)
        OR (op.kind='person.unmerge' AND OLD.person_id=m.surviving_person_id AND NEW.person_id=m.merged_person_id)))
)
BEGIN SELECT RAISE(ABORT,'consent withdrawals cannot be changed'); END;

CREATE TRIGGER merges_bookkeeping_immutable BEFORE UPDATE ON merges
WHEN NEW.id IS NOT OLD.id OR NEW.surviving_person_id IS NOT OLD.surviving_person_id OR NEW.merged_person_id IS NOT OLD.merged_person_id OR NEW.merged_at IS NOT OLD.merged_at OR NEW.merged_by IS NOT OLD.merged_by OR NEW.moved_rows IS NOT OLD.moved_rows OR NEW.created_at IS NOT OLD.created_at OR NEW.operation_id IS NOT OLD.operation_id OR NEW.reason IS NOT OLD.reason
BEGIN SELECT RAISE(ABORT,'merge bookkeeping cannot be changed'); END;
