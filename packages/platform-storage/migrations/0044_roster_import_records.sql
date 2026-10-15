-- Reviewed source evidence stays separate from membership choices.
CREATE TABLE roster_import_records (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK(source IN ('beehiiv','notion_intake')),
  source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 200),
  evidence_hash TEXT NOT NULL,
  person_id TEXT REFERENCES person_keys(id),
  suggested_person_id TEXT REFERENCES person_keys(id),
  state TEXT NOT NULL CHECK(state IN ('applied','held','superseded','erased')),
  reasons TEXT NOT NULL CHECK(json_valid(reasons)),
  evidence TEXT CHECK(evidence IS NULL OR json_valid(evidence)),
  recorded_at TEXT NOT NULL,
  UNIQUE(source,source_id,evidence_hash)
);
CREATE INDEX roster_import_review ON roster_import_records(state,recorded_at,id);
CREATE INDEX roster_import_person ON roster_import_records(person_id);
CREATE TRIGGER roster_import_unassigned_erasure BEFORE UPDATE OF erased_at ON people
WHEN NEW.erased_at IS NOT NULL AND OLD.email IS NOT NULL
BEGIN
  UPDATE roster_import_records SET evidence=NULL,reasons='[]',state='erased'
    WHERE person_id IS NULL AND lower(json_extract(evidence,'$.email'))=lower(OLD.email);
END;
CREATE TRIGGER roster_import_erasure AFTER UPDATE OF erased_at ON person_keys
WHEN NEW.erased_at IS NOT NULL
BEGIN
  UPDATE roster_import_records SET evidence=NULL,reasons='[]',state='erased',suggested_person_id=NULL
    WHERE person_id=NEW.id OR suggested_person_id=NEW.id;
END;
CREATE TRIGGER roster_import_retention BEFORE DELETE ON people
BEGIN
  UPDATE roster_import_records SET evidence=NULL,reasons='[]',state='erased',suggested_person_id=NULL
    WHERE person_id=OLD.id OR suggested_person_id=OLD.id;
END;
CREATE TRIGGER roster_import_no_erased_insert BEFORE INSERT ON roster_import_records
WHEN NEW.evidence IS NOT NULL AND EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id,NEW.suggested_person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'erased roster evidence'); END;
CREATE TRIGGER roster_import_no_erased_update BEFORE UPDATE ON roster_import_records
WHEN NEW.evidence IS NOT NULL AND EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id,NEW.suggested_person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'erased roster evidence'); END;

-- Current membership evidence is distinct from the historical consent log.
CREATE TABLE membership_roll (
  external_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person_keys(id),
  status TEXT NOT NULL CHECK(status IN ('active','inactive','pending','unknown')),
  observed_at TEXT NOT NULL CHECK(julianday(observed_at) IS NOT NULL),
  source_created_at TEXT CHECK(source_created_at IS NULL OR julianday(source_created_at) IS NOT NULL),
  withdrawn_at TEXT CHECK(withdrawn_at IS NULL OR julianday(withdrawn_at) IS NOT NULL),
  entitled INTEGER NOT NULL CHECK(entitled IN (0,1)),
  recognized_at TEXT CHECK(recognized_at IS NULL OR julianday(recognized_at) IS NOT NULL),
  revoked_at TEXT CHECK(revoked_at IS NULL OR julianday(revoked_at) IS NOT NULL),
  review_reason TEXT,
  revision_token TEXT NOT NULL,
  CHECK(entitled=0 OR (recognized_at IS NOT NULL AND revoked_at IS NULL))
);
CREATE INDEX membership_roll_person ON membership_roll(person_id);
INSERT INTO membership_rules(version,description,rule,effective_at,created_at,updated_at)
VALUES(2,'A member has active newsletter consent or recognized current membership; unknown history stays unknown.',
'{"version":2,"description":"A member has active newsletter consent or recognized current membership; unknown history stays unknown.","member_if":{"active_consent":"newsletter","current_roll":true},"former_member_if":{"withdrawn_consent":"newsletter","withdrawn_roll":true}}',
strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));

DROP TRIGGER membership_consent_insert;
DROP TRIGGER membership_consent_update;
DROP TRIGGER membership_consent_delete;
CREATE TRIGGER membership_consent_insert AFTER INSERT ON consent_records WHEN NEW.scope='newsletter' BEGIN
UPDATE membership_roll SET review_reason=NULL WHERE person_id=NEW.person_id AND NEW.withdrawn_at IS NULL AND review_reason IN ('duplicate_review','pending_choice','choice_order_unknown','membership_status_unknown','newer_signup') AND julianday(NEW.given_at)>julianday(observed_at);
UPDATE membership_roll SET entitled=0,review_reason=NULL,revoked_at=NEW.withdrawn_at WHERE person_id IN (NEW.person_id) AND (NEW.withdrawn_at) IS NOT NULL AND (revoked_at IS NULL OR julianday(revoked_at)<julianday(NEW.withdrawn_at));
UPDATE people SET membership_status=(CASE
  WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NULL) THEN 'member'
  WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=people.id OR w.origin_person_id=people.id) AND w.scope='newsletter')
    OR EXISTS(SELECT 1 FROM membership_roll r WHERE r.person_id=people.id AND r.revoked_at IS NOT NULL) THEN 'former_member'
  WHEN EXISTS(SELECT 1 FROM membership_roll r WHERE r.person_id=people.id AND r.entitled=1) THEN 'member'
  ELSE 'not_member' END),membership_rules_version=2,updated_at=NEW.updated_at WHERE id IN (NEW.person_id) AND deleted_at IS NULL AND coalesce(membership_rules_version,2)<=2;
END;
CREATE TRIGGER membership_consent_update AFTER UPDATE OF person_id,scope,withdrawn_at ON consent_records WHEN OLD.scope='newsletter' OR NEW.scope='newsletter' BEGIN
UPDATE membership_roll SET entitled=0,review_reason=NULL,revoked_at=(CASE WHEN NEW.scope='newsletter' THEN NEW.withdrawn_at ELSE NULL END) WHERE person_id IN (NEW.person_id) AND OLD.person_id=NEW.person_id
  AND NOT EXISTS(SELECT 1 FROM staff_operations o JOIN merges m ON m.id=o.target_id
    WHERE o.kind='person.merge' AND o.applied_at IS NULL
      AND m.unmerged_at IS NULL AND m.erased_at IS NULL
      AND NEW.person_id IN (m.surviving_person_id,m.merged_person_id))
  AND (CASE WHEN NEW.scope='newsletter' THEN NEW.withdrawn_at ELSE NULL END) IS NOT NULL AND (revoked_at IS NULL OR julianday(revoked_at)<julianday(CASE WHEN NEW.scope='newsletter' THEN NEW.withdrawn_at ELSE NULL END));
UPDATE people SET membership_status=(CASE
  WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NULL) THEN 'member'
  WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=people.id OR w.origin_person_id=people.id) AND w.scope='newsletter')
    OR EXISTS(SELECT 1 FROM membership_roll r WHERE r.person_id=people.id AND r.revoked_at IS NOT NULL) THEN 'former_member'
  WHEN EXISTS(SELECT 1 FROM membership_roll r WHERE r.person_id=people.id AND r.entitled=1) THEN 'member'
  ELSE 'not_member' END),membership_rules_version=2,updated_at=NEW.updated_at WHERE id IN (OLD.person_id,NEW.person_id) AND deleted_at IS NULL AND coalesce(membership_rules_version,2)<=2;
END;
CREATE TRIGGER membership_consent_delete AFTER DELETE ON consent_records WHEN OLD.scope='newsletter' BEGIN
UPDATE people SET membership_status=(CASE
  WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NULL) THEN 'member'
  WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=people.id OR w.origin_person_id=people.id) AND w.scope='newsletter')
    OR EXISTS(SELECT 1 FROM membership_roll r WHERE r.person_id=people.id AND r.revoked_at IS NOT NULL) THEN 'former_member'
  WHEN EXISTS(SELECT 1 FROM membership_roll r WHERE r.person_id=people.id AND r.entitled=1) THEN 'member'
  ELSE 'not_member' END),membership_rules_version=2,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (OLD.person_id) AND deleted_at IS NULL AND coalesce(membership_rules_version,2)<=2;
END;
CREATE TRIGGER membership_roll_withdrawal AFTER INSERT ON consent_withdrawals WHEN NEW.scope='newsletter' BEGIN
UPDATE membership_roll SET entitled=0,review_reason=NULL,revoked_at=NEW.withdrawn_at WHERE person_id IN (NEW.person_id,NEW.origin_person_id) AND (NEW.withdrawn_at) IS NOT NULL AND (revoked_at IS NULL OR julianday(revoked_at)<julianday(NEW.withdrawn_at));
UPDATE people SET membership_status=(CASE
  WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NULL) THEN 'member'
  WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=people.id OR w.origin_person_id=people.id) AND w.scope='newsletter')
    OR EXISTS(SELECT 1 FROM membership_roll r WHERE r.person_id=people.id AND r.revoked_at IS NOT NULL) THEN 'former_member'
  WHEN EXISTS(SELECT 1 FROM membership_roll r WHERE r.person_id=people.id AND r.entitled=1) THEN 'member'
  ELSE 'not_member' END),membership_rules_version=2,updated_at=NEW.recorded_at WHERE id IN (NEW.person_id,NEW.origin_person_id) AND deleted_at IS NULL AND coalesce(membership_rules_version,2)<=2;
END;
CREATE TRIGGER membership_roll_insert AFTER INSERT ON membership_roll BEGIN
UPDATE people SET membership_status=(CASE
  WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NULL) THEN 'member'
  WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=people.id OR w.origin_person_id=people.id) AND w.scope='newsletter')
    OR EXISTS(SELECT 1 FROM membership_roll r WHERE r.person_id=people.id AND r.revoked_at IS NOT NULL) THEN 'former_member'
  WHEN EXISTS(SELECT 1 FROM membership_roll r WHERE r.person_id=people.id AND r.entitled=1) THEN 'member'
  ELSE 'not_member' END),membership_rules_version=2,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (NEW.person_id) AND deleted_at IS NULL AND coalesce(membership_rules_version,2)<=2;
INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at) SELECT id,1,'queued',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM people WHERE id IN (NEW.person_id) AND deleted_at IS NULL ON CONFLICT(person_id) DO UPDATE SET generation=generation+1,state='queued',requested_at=excluded.requested_at,next_attempt_at=excluded.next_attempt_at,last_failure=NULL;
END;
CREATE TRIGGER membership_roll_update AFTER UPDATE ON membership_roll BEGIN
UPDATE people SET membership_status=(CASE
  WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NULL) THEN 'member'
  WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=people.id OR w.origin_person_id=people.id) AND w.scope='newsletter')
    OR EXISTS(SELECT 1 FROM membership_roll r WHERE r.person_id=people.id AND r.revoked_at IS NOT NULL) THEN 'former_member'
  WHEN EXISTS(SELECT 1 FROM membership_roll r WHERE r.person_id=people.id AND r.entitled=1) THEN 'member'
  ELSE 'not_member' END),membership_rules_version=2,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (OLD.person_id,NEW.person_id) AND deleted_at IS NULL AND coalesce(membership_rules_version,2)<=2;
INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at) SELECT id,1,'queued',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM people WHERE id IN (OLD.person_id,NEW.person_id) AND deleted_at IS NULL ON CONFLICT(person_id) DO UPDATE SET generation=generation+1,state='queued',requested_at=excluded.requested_at,next_attempt_at=excluded.next_attempt_at,last_failure=NULL;
END;
CREATE TRIGGER membership_roll_delete AFTER DELETE ON membership_roll BEGIN
UPDATE people SET membership_status=(CASE
  WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NULL) THEN 'member'
  WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=people.id OR w.origin_person_id=people.id) AND w.scope='newsletter')
    OR EXISTS(SELECT 1 FROM membership_roll r WHERE r.person_id=people.id AND r.revoked_at IS NOT NULL) THEN 'former_member'
  WHEN EXISTS(SELECT 1 FROM membership_roll r WHERE r.person_id=people.id AND r.entitled=1) THEN 'member'
  ELSE 'not_member' END),membership_rules_version=2,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (OLD.person_id) AND deleted_at IS NULL AND coalesce(membership_rules_version,2)<=2;
INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at) SELECT id,1,'queued',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM people WHERE id IN (OLD.person_id) AND deleted_at IS NULL ON CONFLICT(person_id) DO UPDATE SET generation=generation+1,state='queued',requested_at=excluded.requested_at,next_attempt_at=excluded.next_attempt_at,last_failure=NULL;
END;

CREATE TRIGGER membership_roll_erasure AFTER UPDATE OF erased_at ON person_keys
WHEN NEW.erased_at IS NOT NULL
BEGIN DELETE FROM membership_roll WHERE person_id=NEW.id; END;
CREATE TRIGGER membership_roll_retention BEFORE DELETE ON people
BEGIN DELETE FROM membership_roll WHERE person_id=OLD.id; END;
CREATE TRIGGER membership_roll_erased_insert BEFORE INSERT ON membership_roll
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id=NEW.person_id AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'erased membership roll'); END;
CREATE TRIGGER membership_roll_erased_update BEFORE UPDATE ON membership_roll
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id=NEW.person_id AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'erased membership roll'); END;
