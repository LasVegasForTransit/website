-- An API read supplies a current delivery status, not the original choice time.
ALTER TABLE consent_records ADD COLUMN withdrawn_time_basis TEXT NOT NULL DEFAULT 'choice'
  CHECK(withdrawn_time_basis IN ('choice','observed'));
ALTER TABLE consent_withdrawals ADD COLUMN time_basis TEXT NOT NULL DEFAULT 'choice'
  CHECK(time_basis IN ('choice','observed'));
ALTER TABLE consent_withdrawals ADD COLUMN source_occurred_at TEXT;

CREATE INDEX newsletter_receipt_observation ON newsletter_target_receipts(publication_id,target_key,desired,observed_at);
CREATE TABLE newsletter_poll_choices (
  publication_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  status TEXT NOT NULL CHECK(status IN ('active','inactive')),
  observed_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  baseline_active_at TEXT,
  person_id TEXT REFERENCES person_keys(id),
  state TEXT NOT NULL CHECK(state IN ('pending','needs_review','applied','ignored')),
  reason TEXT,
  processed_at TEXT,
  PRIMARY KEY(publication_id,subscription_id),
  FOREIGN KEY(publication_id,subscription_id) REFERENCES beehiiv_subscription_observations(publication_id,subscription_id)
);
CREATE INDEX newsletter_poll_choice_due ON newsletter_poll_choices(publication_id,state,observed_at);
CREATE TABLE newsletter_poll_operations (
  publication_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  person_id TEXT REFERENCES person_keys(id),
  outcome TEXT NOT NULL CHECK(outcome IN ('applied','ignored','needs_review')),
  reason TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(publication_id,subscription_id,revision)
);

CREATE TRIGGER newsletter_poll_new AFTER INSERT ON beehiiv_subscription_observations
WHEN NEW.status IN ('active','inactive') AND NOT EXISTS(
  SELECT 1 FROM identities i JOIN person_keys k ON k.id=i.person_id
  WHERE i.platform='beehiiv' AND i.external_id=NEW.subscription_id AND k.erased_at IS NOT NULL)
BEGIN
  INSERT INTO newsletter_poll_choices(publication_id,subscription_id,revision,status,observed_at,last_seen_at,baseline_active_at,person_id,state,reason)
  SELECT NEW.publication_id,NEW.subscription_id,1,NEW.status,NEW.observed_at,NEW.observed_at,
    (SELECT max(observed_at) FROM newsletter_target_receipts WHERE publication_id=NEW.publication_id AND target_key='id:'||NEW.subscription_id AND desired='active' AND observed_at<=NEW.observed_at),
    (SELECT person_id FROM identities WHERE platform='beehiiv' AND external_id=NEW.subscription_id),
    CASE WHEN EXISTS(SELECT 1 FROM identities WHERE platform='beehiiv' AND external_id=NEW.subscription_id) THEN 'pending' ELSE 'needs_review' END,
    CASE WHEN EXISTS(SELECT 1 FROM identities WHERE platform='beehiiv' AND external_id=NEW.subscription_id) THEN NULL ELSE 'unlinked_account' END
  WHERE NEW.status='active' OR EXISTS(SELECT 1 FROM identities WHERE platform='beehiiv' AND external_id=NEW.subscription_id);
END;

CREATE TRIGGER newsletter_poll_changed AFTER UPDATE ON beehiiv_subscription_observations
WHEN NEW.status IN ('active','inactive') AND NEW.observed_at>=OLD.observed_at AND (
  NEW.status<>OLD.status OR (NEW.status='inactive' AND EXISTS(
    SELECT 1 FROM newsletter_target_receipts WHERE publication_id=NEW.publication_id
      AND target_key='id:'||NEW.subscription_id AND desired='active'
      AND observed_at>OLD.observed_at AND observed_at<=NEW.observed_at)))
  AND NOT EXISTS(SELECT 1 FROM identities i JOIN person_keys k ON k.id=i.person_id
    WHERE i.platform='beehiiv' AND i.external_id=NEW.subscription_id AND k.erased_at IS NOT NULL)
BEGIN
  INSERT INTO newsletter_poll_choices(publication_id,subscription_id,revision,status,observed_at,last_seen_at,baseline_active_at,person_id,state,reason)
  SELECT NEW.publication_id,NEW.subscription_id,1,NEW.status,NEW.observed_at,NEW.observed_at,
    (SELECT max(at) FROM (
      SELECT CASE WHEN OLD.status='active' THEN OLD.observed_at ELSE NULL END AS at
      UNION ALL SELECT max(observed_at) FROM newsletter_target_receipts WHERE publication_id=NEW.publication_id
        AND target_key='id:'||NEW.subscription_id AND desired='active' AND observed_at<=NEW.observed_at)),
    (SELECT person_id FROM identities WHERE platform='beehiiv' AND external_id=NEW.subscription_id),
    CASE WHEN EXISTS(SELECT 1 FROM identities WHERE platform='beehiiv' AND external_id=NEW.subscription_id) THEN 'pending' ELSE 'needs_review' END,
    CASE WHEN EXISTS(SELECT 1 FROM identities WHERE platform='beehiiv' AND external_id=NEW.subscription_id) THEN NULL ELSE 'unlinked_account' END
  WHERE NEW.status='active' OR EXISTS(SELECT 1 FROM identities WHERE platform='beehiiv' AND external_id=NEW.subscription_id)
  ON CONFLICT(publication_id,subscription_id) DO UPDATE SET revision=revision+1,status=excluded.status,
    observed_at=excluded.observed_at,last_seen_at=excluded.last_seen_at,baseline_active_at=excluded.baseline_active_at,
    person_id=excluded.person_id,state=excluded.state,reason=excluded.reason,processed_at=NULL;
END;

CREATE TRIGGER newsletter_poll_seen AFTER UPDATE ON beehiiv_subscription_observations
WHEN NEW.observed_at>=OLD.observed_at
BEGIN
  UPDATE newsletter_poll_choices SET last_seen_at=NEW.observed_at
    WHERE publication_id=NEW.publication_id AND subscription_id=NEW.subscription_id;
END;

-- Existing status copies are reviewed rather than silently treated as consent.
INSERT INTO newsletter_poll_choices(publication_id,subscription_id,revision,status,observed_at,last_seen_at,person_id,state,reason)
SELECT o.publication_id,o.subscription_id,1,o.status,o.observed_at,o.observed_at,i.person_id,
  CASE WHEN i.person_id IS NOT NULL THEN 'pending' ELSE 'needs_review' END,
  CASE WHEN i.person_id IS NOT NULL THEN NULL ELSE 'unlinked_account' END
FROM beehiiv_subscription_observations o LEFT JOIN identities i ON i.platform='beehiiv' AND i.external_id=o.subscription_id
LEFT JOIN person_keys k ON k.id=i.person_id WHERE o.status IN ('active','inactive') AND k.erased_at IS NULL
  AND (o.status='active' OR i.person_id IS NOT NULL);
