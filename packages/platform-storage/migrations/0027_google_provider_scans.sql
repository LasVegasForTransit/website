-- Workspace runners need their own customer-scoped, resumable drift scan.
ALTER TABLE provider_scan_checkpoints RENAME TO provider_scan_checkpoints_before_google;
CREATE TABLE provider_scan_checkpoints (
  provider TEXT NOT NULL CHECK(provider IN ('discord','google_workspace')),
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
INSERT INTO provider_scan_checkpoints
SELECT provider,context_id,started_at,next_scan_at,cursor,in_progress,last_completed_at,lease_token,lease_expires_at
FROM provider_scan_checkpoints_before_google;
DROP TABLE provider_scan_checkpoints_before_google;
