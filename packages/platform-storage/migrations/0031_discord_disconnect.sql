-- Keep the verified cleanup target until Discord confirms managed access ended.
-- The intent follows the identity when member records are combined.
CREATE TABLE discord_disconnects (
  identity_record_id TEXT PRIMARY KEY REFERENCES identities(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL UNIQUE,
  requested_at TEXT NOT NULL
);
