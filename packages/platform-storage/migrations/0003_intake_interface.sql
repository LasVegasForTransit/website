-- The versioned intake interface: consent can now come from any outside form
-- tool (`external_form`), and each submission's idempotency key is kept for 30
-- days so a repeat returns the first answer and changes nothing.

-- SQLite cannot change a CHECK constraint in place, so consent_records is
-- rebuilt with `external_form` added to its sources.
CREATE TABLE consent_records_new (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  scope TEXT NOT NULL CHECK (scope IN ('newsletter', 'event_reminders', 'volunteer_contact')),
  given_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (
    source IN ('join_form', 'newsletter_box', 'google_form', 'external_form', 'beehiiv', 'paper', 'check_in', 'import')
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

CREATE TABLE intake_submissions (
  idempotency_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  response TEXT NOT NULL CHECK (json_valid(response)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
