-- Member sign-in: one-time codes and sign-in links, and sessions. Codes, link
-- tokens and session identifiers are stored only as keyed hashes, so a copy of
-- this database can't sign anyone in.

CREATE TABLE sign_in_codes (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  -- What the code is for, so a sign-in code can't confirm an email change or
  -- the other way round.
  purpose TEXT NOT NULL CHECK (purpose IN ('sign_in', 'confirm_email', 'delete_account')),
  code_hash TEXT NOT NULL,
  link_token_hash TEXT,
  -- For confirm_email: the new address being confirmed.
  new_email TEXT,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX sign_in_codes_person ON sign_in_codes (person_id, purpose);
CREATE UNIQUE INDEX sign_in_codes_link ON sign_in_codes (link_token_hash)
  WHERE link_token_hash IS NOT NULL;

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  type TEXT NOT NULL CHECK (type IN ('member', 'staff')),
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX sessions_person ON sessions (person_id);

-- Members can rejoin the mailing list from their account page, so consent can
-- now come from `account`. SQLite cannot change a CHECK constraint in place,
-- so consent_records is rebuilt, as in 0003.
CREATE TABLE consent_records_new (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  scope TEXT NOT NULL CHECK (scope IN ('newsletter', 'event_reminders', 'volunteer_contact')),
  given_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (
    source IN ('join_form', 'newsletter_box', 'google_form', 'external_form', 'account', 'beehiiv', 'paper', 'check_in', 'import')
  ),
  method TEXT NOT NULL CHECK (method IN ('checkbox', 'double_opt_in', 'paper_signature', 'unknown')),
  wording_version TEXT,
  withdrawn_at TEXT,
  withdrawn_source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO consent_records_new SELECT * FROM consent_records;
DROP TABLE consent_records;
ALTER TABLE consent_records_new RENAME TO consent_records;
CREATE INDEX consent_records_person ON consent_records (person_id, scope);
