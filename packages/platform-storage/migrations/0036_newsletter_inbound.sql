-- Authenticated source time and identifiers survive delivery retries. Addresses
-- are purpose-encrypted; unrelated webhook fields and raw payloads are omitted.
CREATE TABLE newsletter_inbound_events (
  publication_id TEXT NOT NULL,
  id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('subscription.created','subscription.confirmed','subscription.deleted')),
  occurred_at TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  email_key TEXT NOT NULL,
  encrypted_email TEXT,
  received_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','needs_review','applied','ignored')),
  PRIMARY KEY(publication_id,id)
);
CREATE INDEX newsletter_inbound_account ON newsletter_inbound_events(subscription_id,state);
CREATE INDEX newsletter_inbound_email ON newsletter_inbound_events(email_key,state);
CREATE INDEX newsletter_inbound_pending ON newsletter_inbound_events(state,occurred_at);
CREATE TABLE newsletter_inbound_deliveries (
  publication_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY(publication_id,message_id),
  FOREIGN KEY(publication_id,event_id) REFERENCES newsletter_inbound_events(publication_id,id)
);
CREATE TRIGGER newsletter_inbound_source_collision BEFORE INSERT ON newsletter_inbound_events
WHEN EXISTS(SELECT 1 FROM newsletter_inbound_events WHERE publication_id=NEW.publication_id AND id=NEW.id AND fingerprint<>NEW.fingerprint)
BEGIN SELECT RAISE(ABORT,'newsletter_event_conflict'); END;
CREATE TRIGGER newsletter_inbound_delivery_collision BEFORE INSERT ON newsletter_inbound_deliveries
WHEN EXISTS(SELECT 1 FROM newsletter_inbound_deliveries WHERE publication_id=NEW.publication_id AND message_id=NEW.message_id AND event_id<>NEW.event_id)
BEGIN SELECT RAISE(ABORT,'newsletter_event_conflict'); END;
