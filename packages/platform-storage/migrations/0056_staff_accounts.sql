-- Team account setup is separate from newsletter membership and staff roles.
CREATE TABLE staff_team_accounts (
 person_id TEXT PRIMARY KEY REFERENCES person_keys(id), created_at TEXT NOT NULL
);
CREATE TRIGGER staff_team_account_erasure AFTER UPDATE OF erased_at ON people
WHEN NEW.erased_at IS NOT NULL BEGIN
 DELETE FROM staff_team_accounts WHERE person_id=NEW.id;
END;
DROP TRIGGER staff_sso_no_deleted_insert;
CREATE TRIGGER staff_sso_no_deleted_insert BEFORE INSERT ON staff_sso_links
WHEN NOT EXISTS(SELECT 1 FROM people p WHERE p.id=NEW.person_id AND p.deleted_at IS NULL
 AND (p.membership_status='member' OR (p.membership_status='not_member'
 AND EXISTS(SELECT 1 FROM staff_team_accounts t WHERE t.person_id=p.id))))
BEGIN SELECT RAISE(ABORT,'sso_binding_unavailable'); END;
CREATE TABLE staff_member_handoffs (
 token_hash TEXT PRIMARY KEY, pending_hash TEXT NOT NULL,
 auth_mode TEXT NOT NULL CHECK(auth_mode IN ('google','cloudflare-access')),
 staff_origin TEXT NOT NULL, expires_at TEXT NOT NULL,
 member_session_hash TEXT REFERENCES sessions(id_hash) ON DELETE CASCADE,
 person_id TEXT REFERENCES person_keys(id)
);
CREATE TRIGGER staff_handoff_erasure AFTER UPDATE OF erased_at ON people
WHEN NEW.erased_at IS NOT NULL BEGIN
 DELETE FROM staff_member_handoffs WHERE person_id=NEW.id;
END;
