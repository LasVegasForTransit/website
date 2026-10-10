-- A read-backed before-state survives interrupted remote requests until confirmation.
CREATE TABLE provider_access_intents (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider='discord'),
  operation_id TEXT NOT NULL REFERENCES integration_outbox(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id),
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
CREATE INDEX provider_intent_operation ON provider_access_intents(operation_id);
