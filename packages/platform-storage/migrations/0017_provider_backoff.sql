-- Retry timing is shared by every runner using this platform database.
-- Application IDs are public identifiers; credentials and response bodies are never stored.
CREATE TABLE provider_backoffs (
  provider TEXT NOT NULL CHECK(provider IN ('discord')),
  application_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  is_global INTEGER NOT NULL CHECK(is_global IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(provider,application_id)
);
