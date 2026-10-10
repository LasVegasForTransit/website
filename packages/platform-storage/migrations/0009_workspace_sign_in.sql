-- OAuth state is random, short-lived and consumed atomically. Only its hash
-- leaves the browser-facing flow in storage; callbacks cannot replay it.
CREATE TABLE workspace_oauth_states (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL,
  callback_url TEXT NOT NULL,
  origin_url TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX workspace_oauth_expiry ON workspace_oauth_states (expires_at);

CREATE TABLE workspace_link_operations (
  operation_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  workspace_subject TEXT NOT NULL,
  created_at TEXT NOT NULL
);


CREATE TABLE workspace_pending_links (
  token_hash TEXT PRIMARY KEY,
  workspace_subject TEXT NOT NULL,
  workspace_email TEXT NOT NULL,
  given_name TEXT,
  family_name TEXT,
  return_to TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX workspace_pending_expiry ON workspace_pending_links (expires_at);

-- A code for linking cannot sign in or change an email. Preserve all old codes.
CREATE TABLE sign_in_codes_new (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  purpose TEXT NOT NULL CHECK (purpose IN ('sign_in', 'confirm_email', 'delete_account', 'workspace_link')),
  code_hash TEXT NOT NULL,
  link_token_hash TEXT,
  new_email TEXT,
  workspace_link_id TEXT,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((purpose = 'workspace_link') = (workspace_link_id IS NOT NULL))
);
INSERT INTO sign_in_codes_new (id, person_id, purpose, code_hash, link_token_hash, new_email, expires_at, attempts, used_at, created_at, updated_at)
  SELECT id, person_id, purpose, code_hash, link_token_hash, new_email, expires_at, attempts, used_at, created_at, updated_at FROM sign_in_codes;
DROP TABLE sign_in_codes;
ALTER TABLE sign_in_codes_new RENAME TO sign_in_codes;
CREATE INDEX sign_in_codes_person ON sign_in_codes (person_id, purpose);
CREATE UNIQUE INDEX sign_in_codes_link ON sign_in_codes (link_token_hash) WHERE link_token_hash IS NOT NULL;

ALTER TABLE sessions ADD COLUMN workspace_identity_id TEXT REFERENCES identities (id) ON DELETE SET NULL;

-- Verified Google claims cross a preview callback using a browser-bound,
-- one-use ticket. No Google token or person data travels in the redirect.
CREATE TABLE workspace_callback_tickets (
  ticket_hash TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL,
  origin_url TEXT NOT NULL,
  return_to TEXT NOT NULL,
  workspace_subject TEXT NOT NULL,
  workspace_email TEXT NOT NULL,
  given_name TEXT,
  family_name TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX workspace_ticket_expiry ON workspace_callback_tickets (expires_at);
