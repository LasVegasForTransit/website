-- Delivery observations are distinct from consent evidence. Keep provider
-- account references and times, without copying addresses or credentials.
CREATE TABLE beehiiv_poll_checkpoints (
  publication_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  next_scan_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  cursor TEXT CHECK(cursor IS NULL OR length(cursor) BETWEEN 1 AND 4096),
  in_progress INTEGER NOT NULL CHECK(in_progress IN (0,1)),
  pages_read INTEGER NOT NULL DEFAULT 0 CHECK(pages_read>=0),
  accounts_read INTEGER NOT NULL DEFAULT 0 CHECK(accounts_read>=0),
  errors INTEGER NOT NULL DEFAULT 0 CHECK(errors>=0),
  last_failure TEXT CHECK(last_failure IS NULL OR last_failure IN ('provider_error','invalid_response','transport')),
  last_completed_at TEXT,
  last_saved_token TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  CHECK((lease_token IS NULL)=(lease_expires_at IS NULL))
);

CREATE TABLE beehiiv_poll_cursors (
  publication_id TEXT NOT NULL REFERENCES beehiiv_poll_checkpoints(publication_id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  cursor TEXT NOT NULL,
  PRIMARY KEY(publication_id,started_at,cursor)
);

CREATE TABLE beehiiv_subscription_observations (
  publication_id TEXT NOT NULL REFERENCES beehiiv_poll_checkpoints(publication_id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','inactive','pending','validating','invalid','needs_attention','paused')),
  subscription_created_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  last_scan_started_at TEXT NOT NULL,
  PRIMARY KEY(publication_id,subscription_id)
);
