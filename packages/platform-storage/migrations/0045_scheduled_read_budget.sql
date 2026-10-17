-- Scheduled erasure must skip already-erased profiles retained for 30 days.
-- The existing deletion-time index still serves physical retention cleanup.
CREATE INDEX people_pending_erasure ON people(erased_at,deleted_at,id)
  WHERE deleted_at IS NOT NULL;
