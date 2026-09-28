-- The engagement log (platform/storage/engagement.ts). Recording the same
-- event from the same source twice keeps one row, so imports and syncs can
-- run again safely. A single event can't be deleted; a person's events go
-- only when the person themselves has been deleted, which the retention job
-- does. Changing an event was already blocked by 0001.

CREATE UNIQUE INDEX engagement_events_reference
  ON engagement_events (person_id, type, source, reference)
  WHERE reference IS NOT NULL;

CREATE TRIGGER engagement_events_no_single_delete
BEFORE DELETE ON engagement_events
WHEN EXISTS (SELECT 1 FROM people WHERE id = OLD.person_id AND deleted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'engagement events are removed only with a deleted person');
END;
