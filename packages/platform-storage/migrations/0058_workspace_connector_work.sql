CREATE TABLE workspace_connector_claims (
 token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('console','committee')),
 plan TEXT NOT NULL CHECK(json_valid(plan)), lease TEXT CHECK(lease IS NULL OR json_valid(lease)),
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX workspace_claim_expiry ON workspace_connector_claims(expires_at);
CREATE TABLE workspace_console_checks (
 account_id TEXT NOT NULL REFERENCES workspace_directory_accounts(id), resource_id TEXT NOT NULL,
 revision TEXT NOT NULL, lease_hash TEXT NOT NULL, before_granted INTEGER,
 granted INTEGER, group_id TEXT, observed_at TEXT, expires_at TEXT,
 PRIMARY KEY(account_id,resource_id)
);
CREATE TABLE workspace_google_retries (
 operation_id TEXT PRIMARY KEY REFERENCES integration_outbox(id) ON DELETE CASCADE,
 next_attempt_at TEXT NOT NULL, failure TEXT NOT NULL
);
CREATE TRIGGER workspace_claim_erasure AFTER UPDATE OF erased_at ON people WHEN NEW.erased_at IS NOT NULL BEGIN
 DELETE FROM workspace_connector_claims WHERE json_extract(plan,'$.personId')=NEW.id;
END;
