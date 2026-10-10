CREATE TABLE staff_form_tokens (
  token_hash TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES people(id),
  action TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX staff_forms_expiry ON staff_form_tokens(expires_at);
CREATE TABLE person_views (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX person_views_time ON person_views(occurred_at);

CREATE TABLE welcome_claims (
  id TEXT NOT NULL UNIQUE,
  person_id TEXT PRIMARY KEY REFERENCES people(id),
  actor_id TEXT NOT NULL REFERENCES people(id),
  claimed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX welcome_claims_expiry ON welcome_claims(expires_at);
