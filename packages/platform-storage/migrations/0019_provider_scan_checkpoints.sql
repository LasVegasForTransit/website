-- A bounded roster scan resumes after restarts without skipping unqueued accounts.
CREATE TABLE provider_scan_checkpoints (
  provider TEXT NOT NULL CHECK(provider='discord'),
  context_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  next_scan_at TEXT NOT NULL,
  cursor TEXT,
  in_progress INTEGER NOT NULL CHECK(in_progress IN (0,1)),
  last_completed_at TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  PRIMARY KEY(provider,context_id),
  CHECK((lease_token IS NULL)=(lease_expires_at IS NULL))
);
