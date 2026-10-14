-- Unconfirmed subscription creation retains a purpose-encrypted address until
-- its stable remote ID is known. Ordinary profile erasure never restores it.
CREATE TABLE newsletter_write_intents (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES person_keys(id),
  account_key TEXT NOT NULL,
  encrypted_email TEXT,
  subscription_id TEXT,
  created_at TEXT NOT NULL,
  write_started_at TEXT,
  CHECK(encrypted_email IS NOT NULL OR subscription_id IS NOT NULL),
  UNIQUE(publication_id,account_key)
);
CREATE INDEX newsletter_intent_person ON newsletter_write_intents(person_id,publication_id);

CREATE TABLE newsletter_target_receipts (
  publication_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES person_keys(id),
  generation INTEGER NOT NULL,
  revision_hash TEXT NOT NULL,
  target_key TEXT NOT NULL,
  desired TEXT NOT NULL CHECK(desired IN ('active','inactive')),
  observed_at TEXT NOT NULL,
  PRIMARY KEY(publication_id,person_id,generation,target_key)
);

CREATE TABLE newsletter_provider_backoffs (
  publication_id TEXT PRIMARY KEY,
  until_at TEXT NOT NULL
);
