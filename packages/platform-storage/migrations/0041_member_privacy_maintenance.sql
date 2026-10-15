-- Requesters are opaque person keys or named system jobs. No personal profile
-- values belong in the permanent deletion receipt or Workspace review queue.
ALTER TABLE person_erasure_scope ADD COLUMN requested_by TEXT NOT NULL DEFAULT 'retention';
ALTER TABLE person_erasure_scope ADD COLUMN reason TEXT NOT NULL DEFAULT 'legacy'
  CHECK(reason IN ('requested','inactive','legacy'));

CREATE TABLE person_deletion_log (
  person_id TEXT PRIMARY KEY REFERENCES person_keys(id),
  requested_at TEXT CHECK(requested_at IS NULL OR julianday(requested_at) IS NOT NULL),
  requested_by TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('requested','inactive','legacy')),
  operation_id TEXT NOT NULL,
  completed_at TEXT NOT NULL CHECK(julianday(completed_at) IS NOT NULL),
  CHECK(reason='legacy' OR requested_at IS NOT NULL)
);
CREATE TRIGGER person_erasure_requester BEFORE INSERT ON person_erasure_scope
WHEN NEW.requested_by NOT IN ('member','retention')
  AND NOT EXISTS(SELECT 1 FROM person_keys WHERE id=NEW.requested_by)
BEGIN SELECT RAISE(ABORT,'erasure requester must be an opaque person key'); END;
CREATE TRIGGER person_deletion_receipt AFTER DELETE ON person_erasure_scope
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id=OLD.person_id AND erased_at=OLD.requested_at)
BEGIN
  DELETE FROM consent_records WHERE person_id=OLD.person_id;
  DELETE FROM consent_withdrawals WHERE person_id=OLD.person_id;
  DELETE FROM form_submissions WHERE person_id=OLD.person_id;
  DELETE FROM workspace_link_operations WHERE person_id=OLD.person_id;
  DELETE FROM committee_assignments WHERE person_id=OLD.person_id;
  DELETE FROM staff_administrators WHERE person_id=OLD.person_id;
  INSERT INTO person_deletion_log(person_id,requested_at,requested_by,reason,operation_id,completed_at)
    VALUES(OLD.person_id,OLD.requested_at,OLD.requested_by,OLD.reason,OLD.operation_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(person_id) DO NOTHING;
END;
-- Earlier erasure versions left these local records until physical purge.
DELETE FROM consent_records WHERE person_id IN (SELECT id FROM person_keys WHERE erased_at IS NOT NULL);
DELETE FROM consent_withdrawals WHERE person_id IN (SELECT id FROM person_keys WHERE erased_at IS NOT NULL);
DELETE FROM form_submissions WHERE person_id IN (SELECT id FROM person_keys WHERE erased_at IS NOT NULL);
DELETE FROM workspace_link_operations WHERE person_id IN (SELECT id FROM person_keys WHERE erased_at IS NOT NULL);
DELETE FROM committee_assignments WHERE person_id IN (SELECT id FROM person_keys WHERE erased_at IS NOT NULL);
DELETE FROM staff_administrators WHERE person_id IN (SELECT id FROM person_keys WHERE erased_at IS NOT NULL);
-- Historical profiles retain their erasure time, not the original request time.
INSERT INTO person_deletion_log(person_id,requested_at,requested_by,reason,operation_id,completed_at)
  SELECT id,NULL,'retention','legacy','legacy:'||id,erased_at FROM person_keys WHERE erased_at IS NOT NULL;
CREATE TRIGGER person_deletion_log_no_update BEFORE UPDATE ON person_deletion_log
BEGIN SELECT RAISE(ABORT,'deletion receipts cannot be changed'); END;
CREATE TRIGGER person_deletion_log_no_delete BEFORE DELETE ON person_deletion_log
BEGIN SELECT RAISE(ABORT,'deletion receipts cannot be removed'); END;
CREATE TRIGGER person_deletion_log_no_replace BEFORE INSERT ON person_deletion_log
WHEN EXISTS(SELECT 1 FROM person_deletion_log WHERE person_id=NEW.person_id)
BEGIN SELECT RAISE(ABORT,'deletion receipts cannot be replaced'); END;

CREATE TABLE member_privacy_runs (
  local_day TEXT PRIMARY KEY,
  cutoff_at TEXT NOT NULL CHECK(julianday(cutoff_at) IS NOT NULL),
  operation_id TEXT NOT NULL,
  last_attempt_at TEXT NOT NULL CHECK(julianday(last_attempt_at) IS NOT NULL),
  completed_at TEXT CHECK(completed_at IS NULL OR julianday(completed_at) IS NOT NULL)
);

CREATE TABLE workspace_offboarding_queue (
  identity_record_id TEXT PRIMARY KEY REFERENCES identities(id),
  person_id TEXT NOT NULL REFERENCES person_keys(id),
  reason TEXT NOT NULL CHECK(reason IN ('erased','membership_ended')),
  flagged_at TEXT NOT NULL CHECK(julianday(flagged_at) IS NOT NULL),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  reviewed_at TEXT,
  reviewed_by TEXT REFERENCES person_keys(id),
  reviewed_operation_id TEXT UNIQUE,
  CHECK((reviewed_at IS NULL AND reviewed_by IS NULL AND reviewed_operation_id IS NULL)
    OR (julianday(reviewed_at) IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_operation_id IS NOT NULL))
);
CREATE INDEX workspace_offboarding_pending ON workspace_offboarding_queue(flagged_at,identity_record_id)
  WHERE reviewed_at IS NULL;
CREATE TRIGGER workspace_offboarding_erasure AFTER UPDATE OF erased_at ON people
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
  INSERT INTO workspace_offboarding_queue(identity_record_id,person_id,reason,flagged_at)
    SELECT id,person_id,'erased',NEW.erased_at FROM identities
      WHERE person_id=NEW.id AND platform='google_workspace'
    ON CONFLICT(identity_record_id) DO UPDATE SET reason='erased',flagged_at=excluded.flagged_at,
      revision=workspace_offboarding_queue.revision+1,
      reviewed_at=NULL,reviewed_by=NULL,reviewed_operation_id=NULL;
END;
CREATE TRIGGER workspace_offboarding_membership AFTER UPDATE OF membership_status ON people
WHEN OLD.membership_status='member' AND NEW.membership_status<>'member' AND NEW.erased_at IS NULL
BEGIN
  INSERT INTO workspace_offboarding_queue(identity_record_id,person_id,reason,flagged_at)
    SELECT id,person_id,'membership_ended',NEW.updated_at FROM identities
      WHERE person_id=NEW.id AND platform='google_workspace'
    ON CONFLICT(identity_record_id) DO UPDATE SET reason=excluded.reason,flagged_at=excluded.flagged_at,
      revision=workspace_offboarding_queue.revision+1,
      reviewed_at=NULL,reviewed_by=NULL,reviewed_operation_id=NULL;
END;
INSERT INTO workspace_offboarding_queue(identity_record_id,person_id,reason,flagged_at)
  SELECT i.id,i.person_id,CASE WHEN k.erased_at IS NOT NULL THEN 'erased' ELSE 'membership_ended' END,
    coalesce(k.erased_at,p.updated_at,i.updated_at)
  FROM identities i JOIN person_keys k ON k.id=i.person_id LEFT JOIN people p ON p.id=k.id
  WHERE i.platform='google_workspace' AND (k.erased_at IS NOT NULL OR p.membership_status='former_member');
