-- Workspace API quotas need the same restart-safe pause as Discord.
ALTER TABLE provider_backoffs RENAME TO provider_backoffs_before_google;
CREATE TABLE provider_backoffs (
  provider TEXT NOT NULL CHECK(provider IN ('discord','google_workspace')),
  context_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  is_global INTEGER NOT NULL CHECK(is_global IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(provider,context_id)
);
INSERT INTO provider_backoffs(provider,context_id,expires_at,is_global,updated_at)
SELECT provider,application_id,expires_at,is_global,updated_at FROM provider_backoffs_before_google;
DROP TABLE provider_backoffs_before_google;
