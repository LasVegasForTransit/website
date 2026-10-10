-- Per-group readback lets a bounded runner resume without declaring the whole
-- account complete. These contain operational group keys, not personal data.
CREATE TABLE google_group_checkpoints (
  operation_id TEXT NOT NULL REFERENCES integration_outbox(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL,
  revision_hash TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(operation_id,resource_id)
);

-- Preserve outstanding Discord intents while allowing the same read-backed
-- audit protocol for Google. Person keys survive profile retention.
CREATE TABLE provider_access_intents_next (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('discord','google_workspace')),
  operation_id TEXT NOT NULL REFERENCES integration_outbox(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES person_keys(id),
  identity_record_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  identity_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation>=0),
  revision_hash TEXT NOT NULL,
  before_granted INTEGER NOT NULL CHECK(before_granted IN (0,1)),
  after_granted INTEGER NOT NULL CHECK(after_granted IN (0,1)),
  source TEXT NOT NULL,
  requested_by TEXT,
  prepared_at TEXT NOT NULL,
  CHECK(before_granted<>after_granted),
  UNIQUE(provider,context_id,identity_id,resource_id)
);
INSERT INTO provider_access_intents_next SELECT * FROM provider_access_intents;
DROP TABLE provider_access_intents;
ALTER TABLE provider_access_intents_next RENAME TO provider_access_intents;
CREATE INDEX provider_intent_operation ON provider_access_intents(operation_id);
