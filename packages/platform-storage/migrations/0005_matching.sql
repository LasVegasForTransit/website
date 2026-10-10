-- Matching rules, version 1 (platform/storage/matching.ts). A review item can
-- carry what the incoming record said that could not be stored on the new
-- person, such as an email address another person already has. The same
-- pair is queued once per reason, however often a record is processed.

ALTER TABLE review_queue ADD COLUMN details TEXT CHECK (details IS NULL OR json_valid(details));

CREATE UNIQUE INDEX review_queue_pair_reason
  ON review_queue (candidate_person_id, existing_person_id, reason);
CREATE INDEX review_queue_open ON review_queue (created_at) WHERE resolved_at IS NULL;
