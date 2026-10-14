-- Accepted consent and provider retry work share one transaction. Account leases
-- remain held across new generations so an older request cannot race its successor.
CREATE TABLE newsletter_sync_jobs (
  person_id TEXT PRIMARY KEY REFERENCES person_keys(id),
  generation INTEGER NOT NULL CHECK(generation>0),
  state TEXT NOT NULL CHECK(state IN ('queued','running','retry','done','needs_review')),
  requested_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  activation_consent_id TEXT,
  activation_email_key TEXT,
  activation_email_verified_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  last_failure TEXT CHECK(last_failure IS NULL OR last_failure IN ('provider_unavailable','rate_limited','permission_denied','unknown','identity_conflict','consent_evidence_needed')),
  last_publication_id TEXT,
  last_completed_at TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  CHECK((lease_token IS NULL)=(lease_expires_at IS NULL)),
  CHECK((activation_email_key IS NULL)=(activation_email_verified_at IS NULL))
);
CREATE INDEX newsletter_sync_due ON newsletter_sync_jobs(state,next_attempt_at);
CREATE TABLE newsletter_account_leases (
  publication_id TEXT NOT NULL,
  account_key TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(publication_id,account_key)
);

CREATE TRIGGER newsletter_consent_insert AFTER INSERT ON consent_records WHEN NEW.scope='newsletter'
BEGIN
  INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at,activation_consent_id)
  SELECT NEW.person_id,1,'queued',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),CASE WHEN NEW.withdrawn_at IS NULL AND NEW.source IN ('join_form','newsletter_box','google_form','external_form','account','paper') THEN NEW.id ELSE NULL END WHERE 1
  ON CONFLICT(person_id) DO UPDATE SET generation=generation+1,state='queued',
    requested_at=excluded.requested_at,next_attempt_at=excluded.next_attempt_at,last_failure=NULL,
    activation_email_key=CASE WHEN excluded.activation_consent_id IS NOT NULL THEN NULL ELSE newsletter_sync_jobs.activation_email_key END,
    activation_email_verified_at=CASE WHEN excluded.activation_consent_id IS NOT NULL THEN NULL ELSE newsletter_sync_jobs.activation_email_verified_at END,
    activation_consent_id=CASE WHEN excluded.activation_consent_id IS NOT NULL THEN excluded.activation_consent_id
      WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.id=newsletter_sync_jobs.activation_consent_id AND c.person_id=newsletter_sync_jobs.person_id AND c.scope='newsletter' AND c.withdrawn_at IS NULL AND (c.source IN ('join_form','newsletter_box','google_form','external_form','account','paper') OR newsletter_sync_jobs.activation_email_key IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=c.person_id OR w.origin_person_id=c.person_id) AND w.scope='newsletter' AND julianday(w.withdrawn_at)>=julianday(c.given_at))) THEN newsletter_sync_jobs.activation_consent_id ELSE NULL END;
END;

CREATE TRIGGER newsletter_consent_update AFTER UPDATE ON consent_records WHEN OLD.scope='newsletter' OR NEW.scope='newsletter'
BEGIN
  INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at,activation_consent_id)
  SELECT OLD.person_id,1,'queued',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL WHERE 1
  ON CONFLICT(person_id) DO UPDATE SET generation=generation+1,state='queued',
    requested_at=excluded.requested_at,next_attempt_at=excluded.next_attempt_at,last_failure=NULL,
    activation_consent_id=CASE WHEN excluded.activation_consent_id IS NOT NULL THEN excluded.activation_consent_id
      WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.id=newsletter_sync_jobs.activation_consent_id AND c.person_id=newsletter_sync_jobs.person_id AND c.scope='newsletter' AND c.withdrawn_at IS NULL AND (c.source IN ('join_form','newsletter_box','google_form','external_form','account','paper') OR newsletter_sync_jobs.activation_email_key IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=c.person_id OR w.origin_person_id=c.person_id) AND w.scope='newsletter' AND julianday(w.withdrawn_at)>=julianday(c.given_at))) THEN newsletter_sync_jobs.activation_consent_id ELSE NULL END;
  INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at,activation_consent_id)
  SELECT NEW.person_id,1,'queued',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL WHERE NEW.person_id<>OLD.person_id
  ON CONFLICT(person_id) DO UPDATE SET generation=generation+1,state='queued',
    requested_at=excluded.requested_at,next_attempt_at=excluded.next_attempt_at,last_failure=NULL,
    activation_consent_id=CASE WHEN excluded.activation_consent_id IS NOT NULL THEN excluded.activation_consent_id
      WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.id=newsletter_sync_jobs.activation_consent_id AND c.person_id=newsletter_sync_jobs.person_id AND c.scope='newsletter' AND c.withdrawn_at IS NULL AND (c.source IN ('join_form','newsletter_box','google_form','external_form','account','paper') OR newsletter_sync_jobs.activation_email_key IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=c.person_id OR w.origin_person_id=c.person_id) AND w.scope='newsletter' AND julianday(w.withdrawn_at)>=julianday(c.given_at))) THEN newsletter_sync_jobs.activation_consent_id ELSE NULL END;
END;

CREATE TRIGGER newsletter_consent_delete AFTER DELETE ON consent_records WHEN OLD.scope='newsletter'
BEGIN
  INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at,activation_consent_id)
  SELECT OLD.person_id,1,'queued',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL WHERE 1
  ON CONFLICT(person_id) DO UPDATE SET generation=generation+1,state='queued',
    requested_at=excluded.requested_at,next_attempt_at=excluded.next_attempt_at,last_failure=NULL,
    activation_consent_id=CASE WHEN excluded.activation_consent_id IS NOT NULL THEN excluded.activation_consent_id
      WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.id=newsletter_sync_jobs.activation_consent_id AND c.person_id=newsletter_sync_jobs.person_id AND c.scope='newsletter' AND c.withdrawn_at IS NULL AND (c.source IN ('join_form','newsletter_box','google_form','external_form','account','paper') OR newsletter_sync_jobs.activation_email_key IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=c.person_id OR w.origin_person_id=c.person_id) AND w.scope='newsletter' AND julianday(w.withdrawn_at)>=julianday(c.given_at))) THEN newsletter_sync_jobs.activation_consent_id ELSE NULL END;
END;

CREATE TRIGGER newsletter_withdrawal_insert AFTER INSERT ON consent_withdrawals WHEN NEW.scope='newsletter'
BEGIN
  INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at,activation_consent_id)
  SELECT NEW.person_id,1,'queued',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL WHERE 1
  ON CONFLICT(person_id) DO UPDATE SET generation=generation+1,state='queued',
    requested_at=excluded.requested_at,next_attempt_at=excluded.next_attempt_at,last_failure=NULL,
    activation_consent_id=CASE WHEN excluded.activation_consent_id IS NOT NULL THEN excluded.activation_consent_id
      WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.id=newsletter_sync_jobs.activation_consent_id AND c.person_id=newsletter_sync_jobs.person_id AND c.scope='newsletter' AND c.withdrawn_at IS NULL AND (c.source IN ('join_form','newsletter_box','google_form','external_form','account','paper') OR newsletter_sync_jobs.activation_email_key IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=c.person_id OR w.origin_person_id=c.person_id) AND w.scope='newsletter' AND julianday(w.withdrawn_at)>=julianday(c.given_at))) THEN newsletter_sync_jobs.activation_consent_id ELSE NULL END;
END;

CREATE TRIGGER newsletter_identity_insert AFTER INSERT ON identities WHEN NEW.platform='beehiiv'
BEGIN
  INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at,activation_consent_id)
  SELECT NEW.person_id,1,'queued',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL WHERE 1
  ON CONFLICT(person_id) DO UPDATE SET generation=generation+1,state='queued',
    requested_at=excluded.requested_at,next_attempt_at=excluded.next_attempt_at,last_failure=NULL,
    activation_consent_id=CASE WHEN excluded.activation_consent_id IS NOT NULL THEN excluded.activation_consent_id
      WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.id=newsletter_sync_jobs.activation_consent_id AND c.person_id=newsletter_sync_jobs.person_id AND c.scope='newsletter' AND c.withdrawn_at IS NULL AND (c.source IN ('join_form','newsletter_box','google_form','external_form','account','paper') OR newsletter_sync_jobs.activation_email_key IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=c.person_id OR w.origin_person_id=c.person_id) AND w.scope='newsletter' AND julianday(w.withdrawn_at)>=julianday(c.given_at))) THEN newsletter_sync_jobs.activation_consent_id ELSE NULL END;
END;

CREATE TRIGGER newsletter_identity_update AFTER UPDATE ON identities
WHEN (OLD.platform='beehiiv' OR NEW.platform='beehiiv') AND (NEW.person_id IS NOT OLD.person_id OR NEW.platform IS NOT OLD.platform OR NEW.external_id IS NOT OLD.external_id OR NEW.external_email IS NOT OLD.external_email OR NEW.link_method IS NOT OLD.link_method)
BEGIN
  INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at,activation_consent_id)
  SELECT OLD.person_id,1,'queued',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL WHERE 1
  ON CONFLICT(person_id) DO UPDATE SET generation=generation+1,state='queued',
    requested_at=excluded.requested_at,next_attempt_at=excluded.next_attempt_at,last_failure=NULL,
    activation_consent_id=CASE WHEN excluded.activation_consent_id IS NOT NULL THEN excluded.activation_consent_id
      WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.id=newsletter_sync_jobs.activation_consent_id AND c.person_id=newsletter_sync_jobs.person_id AND c.scope='newsletter' AND c.withdrawn_at IS NULL AND (c.source IN ('join_form','newsletter_box','google_form','external_form','account','paper') OR newsletter_sync_jobs.activation_email_key IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=c.person_id OR w.origin_person_id=c.person_id) AND w.scope='newsletter' AND julianday(w.withdrawn_at)>=julianday(c.given_at))) THEN newsletter_sync_jobs.activation_consent_id ELSE NULL END;
  INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at,activation_consent_id)
  SELECT NEW.person_id,1,'queued',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL WHERE NEW.person_id<>OLD.person_id
  ON CONFLICT(person_id) DO UPDATE SET generation=generation+1,state='queued',
    requested_at=excluded.requested_at,next_attempt_at=excluded.next_attempt_at,last_failure=NULL,
    activation_consent_id=CASE WHEN excluded.activation_consent_id IS NOT NULL THEN excluded.activation_consent_id
      WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.id=newsletter_sync_jobs.activation_consent_id AND c.person_id=newsletter_sync_jobs.person_id AND c.scope='newsletter' AND c.withdrawn_at IS NULL AND (c.source IN ('join_form','newsletter_box','google_form','external_form','account','paper') OR newsletter_sync_jobs.activation_email_key IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=c.person_id OR w.origin_person_id=c.person_id) AND w.scope='newsletter' AND julianday(w.withdrawn_at)>=julianday(c.given_at))) THEN newsletter_sync_jobs.activation_consent_id ELSE NULL END;
END;

CREATE TRIGGER newsletter_identity_delete AFTER DELETE ON identities WHEN OLD.platform='beehiiv'
BEGIN
  INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at,activation_consent_id)
  SELECT OLD.person_id,1,'queued',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL WHERE 1
  ON CONFLICT(person_id) DO UPDATE SET generation=generation+1,state='queued',
    requested_at=excluded.requested_at,next_attempt_at=excluded.next_attempt_at,last_failure=NULL,
    activation_consent_id=CASE WHEN excluded.activation_consent_id IS NOT NULL THEN excluded.activation_consent_id
      WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.id=newsletter_sync_jobs.activation_consent_id AND c.person_id=newsletter_sync_jobs.person_id AND c.scope='newsletter' AND c.withdrawn_at IS NULL AND (c.source IN ('join_form','newsletter_box','google_form','external_form','account','paper') OR newsletter_sync_jobs.activation_email_key IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=c.person_id OR w.origin_person_id=c.person_id) AND w.scope='newsletter' AND julianday(w.withdrawn_at)>=julianday(c.given_at))) THEN newsletter_sync_jobs.activation_consent_id ELSE NULL END;
END;

CREATE TRIGGER newsletter_profile_update AFTER UPDATE OF email,deleted_at ON people
WHEN (NEW.email IS NOT OLD.email OR NEW.deleted_at IS NOT OLD.deleted_at) AND (EXISTS(SELECT 1 FROM consent_records WHERE person_id=NEW.id AND scope='newsletter') OR EXISTS(SELECT 1 FROM identities WHERE person_id=NEW.id AND platform='beehiiv') OR EXISTS(SELECT 1 FROM newsletter_sync_jobs WHERE person_id=NEW.id))
BEGIN
  INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at,activation_consent_id)
  SELECT NEW.id,1,'queued',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL WHERE 1
  ON CONFLICT(person_id) DO UPDATE SET generation=generation+1,state='queued',
    requested_at=excluded.requested_at,next_attempt_at=excluded.next_attempt_at,last_failure=NULL,
    activation_consent_id=CASE WHEN excluded.activation_consent_id IS NOT NULL THEN excluded.activation_consent_id
      WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.id=newsletter_sync_jobs.activation_consent_id AND c.person_id=newsletter_sync_jobs.person_id AND c.scope='newsletter' AND c.withdrawn_at IS NULL AND (c.source IN ('join_form','newsletter_box','google_form','external_form','account','paper') OR newsletter_sync_jobs.activation_email_key IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=c.person_id OR w.origin_person_id=c.person_id) AND w.scope='newsletter' AND julianday(w.withdrawn_at)>=julianday(c.given_at))) THEN newsletter_sync_jobs.activation_consent_id ELSE NULL END;
END;

-- Existing source history permits observation and cleanup, never a fresh reactivation.
INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at)
SELECT k.id,1,'queued',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM person_keys k WHERE EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=k.id AND c.scope='newsletter') OR EXISTS(SELECT 1 FROM identities i WHERE i.person_id=k.id AND i.platform='beehiiv');
