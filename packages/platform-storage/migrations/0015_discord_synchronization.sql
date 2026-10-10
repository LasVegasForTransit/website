-- Leases serialize requests for the same account across jobs and Worker instances.
CREATE TABLE provider_account_leases (
  provider TEXT NOT NULL CHECK(provider IN ('discord','google_workspace')),
  context_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(provider,context_id,identity_id)
);
CREATE INDEX provider_lease_expiry ON provider_account_leases(expires_at);

-- Discord display data is an external snapshot, never canonical LVBT contact data.
CREATE TABLE discord_profiles (
  identity_record_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  avatar TEXT,
  nickname TEXT,
  in_guild INTEGER NOT NULL CHECK(in_guild IN (0,1)),
  pending INTEGER NOT NULL CHECK(pending IN (0,1)),
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(identity_record_id,guild_id)
);

-- A provider receipt does not imply the other providers completed the outbox job.
CREATE TABLE provider_operation_receipts (
  operation_id TEXT NOT NULL REFERENCES integration_outbox(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('discord','google_workspace')),
  state TEXT NOT NULL CHECK(state IN ('done','retry')),
  failure TEXT CHECK(failure IS NULL OR failure IN ('provider_unavailable','rate_limited','permission_denied','unknown')),
  revision_hash TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(operation_id,provider),
  CHECK(state='retry' OR failure IS NULL)
);
