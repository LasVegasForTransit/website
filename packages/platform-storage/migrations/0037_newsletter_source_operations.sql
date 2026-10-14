-- One nonce-fenced transaction applies an authenticated source choice and its
-- inbox outcome. Consumed addresses are removed from the durable inbox.
CREATE TABLE newsletter_source_operations (
  publication_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  person_id TEXT REFERENCES person_keys(id),
  outcome TEXT NOT NULL CHECK(outcome IN ('applied','ignored','needs_review')),
  reason TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(publication_id,event_id),
  FOREIGN KEY(publication_id,event_id) REFERENCES newsletter_inbound_events(publication_id,id)
);

-- An acknowledged or ambiguous outbound request may later produce a webhook.
-- Keep minimal attempted-write provenance after the recovery intent is finished.
CREATE TABLE newsletter_write_attempts (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES person_keys(id),
  account_key TEXT NOT NULL,
  subscription_id TEXT,
  desired TEXT NOT NULL CHECK(desired IN ('active','inactive')),
  started_at TEXT NOT NULL
);
CREATE INDEX newsletter_attempt_account ON newsletter_write_attempts(publication_id,account_key);
CREATE INDEX newsletter_attempt_subscription ON newsletter_write_attempts(publication_id,subscription_id);
