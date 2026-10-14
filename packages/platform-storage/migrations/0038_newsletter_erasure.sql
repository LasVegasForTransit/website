-- Keep only an address fingerprint and erasure time to stop delayed messages
-- from recreating a removed profile. No name, address or message body is kept.
CREATE TABLE newsletter_address_tombstones (
  email_key TEXT PRIMARY KEY,
  erased_at TEXT NOT NULL
);

-- The temporary guard stores only address fingerprints and is empty after a
-- successful erasure. A changed address or merge aborts the batch.
CREATE TABLE newsletter_erasure_checks (
  operation_id TEXT PRIMARY KEY,
  valid_snapshot INTEGER NOT NULL CHECK(valid_snapshot=1),
  email_keys TEXT NOT NULL
);

CREATE TRIGGER newsletter_inbound_erased_insert AFTER INSERT ON newsletter_inbound_events
WHEN NEW.encrypted_email IS NOT NULL AND (
  EXISTS(SELECT 1 FROM newsletter_address_tombstones t WHERE t.email_key=NEW.email_key
    AND julianday(NEW.occurred_at)<=julianday(t.erased_at))
  OR EXISTS(SELECT 1 FROM identities i JOIN person_keys k ON k.id=i.person_id
    WHERE i.platform='beehiiv' AND i.external_id=NEW.subscription_id AND k.erased_at IS NOT NULL))
BEGIN
  UPDATE newsletter_inbound_events SET state='ignored',encrypted_email=NULL
    WHERE publication_id=NEW.publication_id AND id=NEW.id;
END;

-- These copies follow a profile's authorized physical purge. Keeping their
-- removal in the same statement leaves room for newsletter erasure within the
-- worker's database-query limit, without splitting the retention transaction.
CREATE TRIGGER person_retention_profile_copies BEFORE DELETE ON people
WHEN EXISTS(SELECT 1 FROM person_retention_scope s WHERE s.person_id=OLD.id)
BEGIN
  DELETE FROM engagement_events WHERE person_id=OLD.id;
  DELETE FROM field_sources WHERE person_id=OLD.id;
  DELETE FROM sign_in_codes WHERE person_id=OLD.id;
  DELETE FROM sessions WHERE person_id=OLD.id;
  DELETE FROM discord_link_states WHERE person_id=OLD.id;
  DELETE FROM access_observations WHERE person_id=OLD.id;
  DELETE FROM discord_profiles WHERE identity_record_id IN (SELECT id FROM identities WHERE person_id=OLD.id);
  DELETE FROM discord_identity_profiles WHERE identity_record_id IN (SELECT id FROM identities WHERE person_id=OLD.id);
  DELETE FROM workspace_pending_links WHERE workspace_subject IN (SELECT external_id FROM identities WHERE platform='google_workspace' AND person_id=OLD.id);
  DELETE FROM workspace_callback_tickets WHERE workspace_subject IN (SELECT external_id FROM identities WHERE platform='google_workspace' AND person_id=OLD.id);
END;

CREATE TRIGGER newsletter_inbound_erased_update AFTER UPDATE OF encrypted_email ON newsletter_inbound_events
WHEN NEW.encrypted_email IS NOT NULL AND (
  EXISTS(SELECT 1 FROM newsletter_address_tombstones t WHERE t.email_key=NEW.email_key
    AND julianday(NEW.occurred_at)<=julianday(t.erased_at))
  OR EXISTS(SELECT 1 FROM identities i JOIN person_keys k ON k.id=i.person_id
    WHERE i.platform='beehiiv' AND i.external_id=NEW.subscription_id AND k.erased_at IS NOT NULL))
BEGIN
  UPDATE newsletter_inbound_events SET state='ignored',encrypted_email=NULL
    WHERE publication_id=NEW.publication_id AND id=NEW.id;
END;
