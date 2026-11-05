-- Keep Directory identity independent of mutable person ownership. The view
-- follows an identity through an approved merge/undo without duplicating it.
CREATE TABLE workspace_directory_accounts (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, user_id TEXT NOT NULL,
 identity_record_id TEXT REFERENCES identities(id) ON DELETE SET NULL,
 email TEXT, org_unit_id TEXT,
 state TEXT NOT NULL CHECK(state IN ('active','inactive','review','excluded','revoked')),
 provisional INTEGER NOT NULL DEFAULT 0 CHECK(provisional IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 1,
 observed_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 console_due_at TEXT NOT NULL, console_state TEXT NOT NULL DEFAULT 'unknown',
 console_checked_at TEXT, console_failure TEXT, console_attempts INTEGER NOT NULL DEFAULT 0,
 console_lease TEXT, console_lease_until TEXT,
 UNIQUE(customer_id,user_id), UNIQUE(identity_record_id)
);
CREATE INDEX workspace_console_due ON workspace_directory_accounts(console_due_at);
CREATE VIEW workspace_enrollments AS
 SELECT d.*,i.person_id FROM workspace_directory_accounts d LEFT JOIN identities i ON i.id=d.identity_record_id;
CREATE TRIGGER workspace_account_status AFTER UPDATE OF state,email,org_unit_id ON workspace_directory_accounts
WHEN OLD.state IS NOT NEW.state OR OLD.email IS NOT NEW.email OR OLD.org_unit_id IS NOT NEW.org_unit_id BEGIN
 DELETE FROM sessions WHERE type='staff' AND person_id IN
  (SELECT person_id FROM identities WHERE id=NEW.identity_record_id);
 INSERT INTO reconcile_generations(person_id,target_id,generation)
  SELECT person_id,'person',1 FROM identities WHERE id=NEW.identity_record_id
  ON CONFLICT(person_id,target_id) DO UPDATE SET generation=generation+1;
 UPDATE reconcile_generations SET generation=generation+1 WHERE target_id<>'person' AND person_id IN
  (SELECT person_id FROM identities WHERE id=NEW.identity_record_id);
 UPDATE integration_outbox SET state='superseded',updated_at=NEW.updated_at WHERE state IN ('queued','running','retry')
  AND person_id IN (SELECT person_id FROM identities WHERE id=NEW.identity_record_id);
 INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
  SELECT lower(hex(randomblob(16)))||':'||g.target_id,(CASE WHEN g.target_id='person' THEN 'person_reconcile' ELSE 'committee_reconcile' END),
  g.person_id,g.target_id,g.generation,'{"source":"workspace_account_changed"}',NEW.updated_at,NEW.updated_at,NEW.updated_at
  FROM reconcile_generations g JOIN identities i ON i.person_id=g.person_id WHERE i.id=NEW.identity_record_id;
END;
CREATE TRIGGER workspace_account_insert AFTER INSERT ON workspace_directory_accounts
WHEN NEW.identity_record_id IS NOT NULL BEGIN
 INSERT INTO reconcile_generations(person_id,target_id,generation)
  SELECT person_id,'person',1 FROM identities WHERE id=NEW.identity_record_id
  ON CONFLICT(person_id,target_id) DO UPDATE SET generation=generation+1;
 INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
  SELECT lower(hex(randomblob(16))),'person_reconcile',g.person_id,'person',g.generation,
  '{"source":"workspace_enrolled"}',NEW.updated_at,NEW.updated_at,NEW.updated_at
  FROM reconcile_generations g JOIN identities i ON i.person_id=g.person_id WHERE g.target_id='person' AND i.id=NEW.identity_record_id;
END;
CREATE TRIGGER workspace_account_erasure AFTER UPDATE OF erased_at ON people WHEN NEW.erased_at IS NOT NULL BEGIN
 UPDATE workspace_directory_accounts SET state='revoked',email=NULL,org_unit_id=NULL,revision=revision+1,
  updated_at=NEW.erased_at,console_due_at=NEW.erased_at
  WHERE identity_record_id IN (SELECT id FROM identities WHERE person_id=NEW.id);
END;
CREATE TRIGGER workspace_identity_removed BEFORE DELETE ON identities WHEN OLD.platform='google_workspace' BEGIN
 UPDATE workspace_directory_accounts SET state='revoked',email=NULL,org_unit_id=NULL,revision=revision+1,
  console_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE identity_record_id=OLD.id;
END;
CREATE TRIGGER workspace_identity_transferred AFTER UPDATE OF person_id ON identities
WHEN NEW.person_id IS NOT OLD.person_id BEGIN
 UPDATE workspace_directory_accounts SET provisional=0,revision=revision+1,
  console_due_at=NEW.updated_at WHERE identity_record_id=NEW.id;
END;
-- Former members with a current human enrollment receive only basic tools.
DROP TRIGGER staff_sso_no_deleted_insert;
CREATE TRIGGER staff_sso_no_deleted_insert BEFORE INSERT ON staff_sso_links
WHEN NOT EXISTS(SELECT 1 FROM people p WHERE p.id=NEW.person_id AND p.deleted_at IS NULL
 AND (p.membership_status='member' OR EXISTS(SELECT 1 FROM staff_team_accounts t WHERE t.person_id=p.id))
 AND NOT EXISTS(SELECT 1 FROM workspace_enrollments e WHERE e.person_id=p.id AND e.state<>'active'))
BEGIN SELECT RAISE(ABORT,'sso_binding_unavailable'); END;
