CREATE TABLE staff_sso_links (
 id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES person_keys(id), issuer TEXT NOT NULL,
 subject TEXT NOT NULL, email TEXT, created_at TEXT NOT NULL, revoked_at TEXT,
 UNIQUE(issuer,subject)
);
CREATE INDEX staff_sso_links_person ON staff_sso_links(person_id);
CREATE TABLE staff_sso_pending (
 token_hash TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
 workspace_email TEXT NOT NULL, return_to TEXT NOT NULL, principal_expires_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
ALTER TABLE sessions ADD COLUMN sso_link_id TEXT REFERENCES staff_sso_links(id);
ALTER TABLE sessions ADD COLUMN authentication_source TEXT;
UPDATE sessions SET authentication_source='google' WHERE workspace_identity_id IS NOT NULL;
CREATE TRIGGER staff_sso_revocation AFTER UPDATE OF revoked_at ON staff_sso_links
WHEN NEW.revoked_at IS NOT NULL BEGIN
 DELETE FROM sessions WHERE sso_link_id=NEW.id;
 DELETE FROM staff_sso_pending WHERE issuer=NEW.issuer AND subject=NEW.subject;
END;
CREATE TRIGGER staff_sso_no_rebind BEFORE UPDATE ON staff_sso_links
WHEN NEW.issuer IS NOT OLD.issuer OR NEW.subject IS NOT OLD.subject
 OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
 OR (NEW.person_id IS NOT OLD.person_id AND EXISTS(SELECT 1 FROM person_keys WHERE id=NEW.person_id AND erased_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'sso_binding_unavailable'); END;
CREATE TRIGGER staff_sso_no_deleted_insert BEFORE INSERT ON staff_sso_links
WHEN NOT EXISTS(SELECT 1 FROM people WHERE id=NEW.person_id AND deleted_at IS NULL AND membership_status='member')
BEGIN SELECT RAISE(ABORT,'sso_binding_unavailable'); END;
CREATE TRIGGER staff_sso_no_delete BEFORE DELETE ON staff_sso_links
BEGIN SELECT RAISE(ABORT,'sso_links_require_tombstones'); END;

CREATE TRIGGER staff_sso_person_erasure AFTER UPDATE OF erased_at ON people
WHEN NEW.erased_at IS NOT NULL BEGIN
 UPDATE staff_sso_links SET revoked_at=coalesce(revoked_at,NEW.erased_at),email=NULL WHERE person_id=NEW.id;
END;
-- A not-yet-linked principal can still be associated with an erased or merged
-- person through its bound membership proof. Clear that pending credential too.
CREATE TRIGGER staff_sso_proof_removed AFTER DELETE ON sign_in_codes
WHEN OLD.workspace_link_id IS NOT NULL BEGIN
 DELETE FROM staff_sso_pending WHERE token_hash=OLD.workspace_link_id;
END;
