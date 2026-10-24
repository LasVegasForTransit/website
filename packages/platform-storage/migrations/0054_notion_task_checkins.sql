-- Task routing is independent of membership and of Discord delivery consent.
CREATE TABLE task_checkin_sources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  policy_json TEXT NOT NULL CHECK(json_valid(policy_json)),
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 365),
  retention_checked_at TEXT,
  updated_by TEXT REFERENCES people(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);
-- An incomplete paused draft must not discard the last explicit privacy limit.
CREATE TRIGGER task_checkin_retention_insert AFTER INSERT ON task_checkin_sources
WHEN json_type(NEW.policy_json,'$.retentionDays')='integer'
  AND json_extract(NEW.policy_json,'$.retentionDays') BETWEEN 1 AND 365 BEGIN
  UPDATE task_checkin_sources SET retention_days=json_extract(NEW.policy_json,'$.retentionDays') WHERE id=NEW.id;
END;
CREATE TRIGGER task_checkin_retention_update AFTER UPDATE OF policy_json ON task_checkin_sources
WHEN json_type(NEW.policy_json,'$.retentionDays')='integer'
  AND json_extract(NEW.policy_json,'$.retentionDays') BETWEEN 1 AND 365 BEGIN
  UPDATE task_checkin_sources SET retention_days=json_extract(NEW.policy_json,'$.retentionDays') WHERE id=NEW.id;
END;
CREATE TABLE task_checkin_mappings (
  version TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL,
  notion_user_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  confirmed_by TEXT REFERENCES people(id) ON DELETE SET NULL,
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,notion_user_id),
  UNIQUE(workspace_id,person_id)
);
CREATE TABLE task_checkin_consent_receipts (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES task_checkin_sources(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('active','paused','opted_out')),
  policy_revision INTEGER NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0 CHECK(applied IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TABLE task_checkin_consents (
  source_id TEXT NOT NULL REFERENCES task_checkin_sources(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','paused','opted_out')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  policy_revision INTEGER NOT NULL,
  interaction_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(source_id,person_id)
);
CREATE TABLE task_checkin_tasks (
  source_id TEXT NOT NULL REFERENCES task_checkin_sources(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  source_edited_at TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  inactive_since TEXT,
  history_cleared_at TEXT,
  seen_scan_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(source_id,task_id)
);
CREATE TABLE task_checkin_scans (
  source_id TEXT PRIMARY KEY REFERENCES task_checkin_sources(id) ON DELETE CASCADE,
  scan_id TEXT NOT NULL,
  policy_revision INTEGER NOT NULL,
  cursor TEXT,
  state TEXT NOT NULL CHECK(state IN ('scanning','complete','failed')),
  claim_token TEXT,
  lease_expires_at TEXT,
  next_attempt_at TEXT NOT NULL,
  reason TEXT,
  last_completed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE task_checkin_operations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  task_revision TEXT NOT NULL,
  consent_revision INTEGER NOT NULL,
  policy_revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('delivery','progress','blocker','complete','extension','snooze')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(payload_json)<=8000),
  history_cleared_at TEXT,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','confirmed','retryable','held','failed','superseded')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  next_attempt_at TEXT NOT NULL,
  claim_token TEXT,
  lease_expires_at TEXT,
  reason TEXT,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(source_id,task_id) REFERENCES task_checkin_tasks(source_id,task_id) ON DELETE CASCADE
);
CREATE INDEX task_checkin_operation_queue ON task_checkin_operations(state,next_attempt_at);
CREATE INDEX task_checkin_operation_person ON task_checkin_operations(person_id,source_id);
CREATE INDEX task_checkin_response_rate ON task_checkin_operations(source_id,person_id,created_at) WHERE kind<>'delivery';
CREATE TABLE task_checkin_cards (
  source_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  task_revision TEXT NOT NULL,
  consent_revision INTEGER NOT NULL,
  policy_revision INTEGER NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  snoozed_until TEXT,
  last_evaluated_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(source_id,task_id,person_id),
  FOREIGN KEY(source_id,task_id) REFERENCES task_checkin_tasks(source_id,task_id) ON DELETE CASCADE
);
CREATE TABLE task_checkin_retired_cards (
  token TEXT NOT NULL PRIMARY KEY,
  source_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  task_revision TEXT NOT NULL,
  consent_revision INTEGER NOT NULL,
  policy_revision INTEGER NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  snoozed_until TEXT,
  retired_at TEXT NOT NULL,
  FOREIGN KEY(source_id,task_id,person_id) REFERENCES task_checkin_cards(source_id,task_id,person_id) ON DELETE CASCADE
);
CREATE TRIGGER task_checkin_retire_card BEFORE UPDATE OF token ON task_checkin_cards
WHEN OLD.token<>NEW.token BEGIN
  INSERT INTO task_checkin_retired_cards(token,source_id,task_id,person_id,task_revision,
    consent_revision,policy_revision,channel_id,message_id,snoozed_until,retired_at)
  VALUES(OLD.token,OLD.source_id,OLD.task_id,OLD.person_id,OLD.task_revision,
    OLD.consent_revision,OLD.policy_revision,OLD.channel_id,OLD.message_id,OLD.snoozed_until,NEW.updated_at);
END;
CREATE TABLE task_checkin_digests (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES task_checkin_sources(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  policy_revision INTEGER NOT NULL,
  consent_revision INTEGER NOT NULL,
  notion_user_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','confirmed','retryable','held','failed','superseded')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  claim_token TEXT,
  lease_expires_at TEXT,
  next_attempt_at TEXT NOT NULL,
  reason TEXT,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id,person_id,day)
);
CREATE INDEX task_checkin_digest_queue ON task_checkin_digests(source_id,state,next_attempt_at);
CREATE TABLE task_checkin_card_refreshes (
  source_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  operation_id TEXT REFERENCES task_checkin_operations(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation>0),
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','retryable','confirmed','failed','superseded')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  claim_token TEXT,
  claimed_generation INTEGER,
  lease_expires_at TEXT,
  next_attempt_at TEXT NOT NULL,
  reason TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(source_id,task_id,person_id),
  FOREIGN KEY(source_id,task_id,person_id) REFERENCES task_checkin_cards(source_id,task_id,person_id) ON DELETE CASCADE
);
CREATE INDEX task_checkin_card_refresh_queue ON task_checkin_card_refreshes(source_id,state,next_attempt_at);
CREATE TRIGGER task_checkin_consent_supersedes AFTER UPDATE ON task_checkin_consents
BEGIN
  UPDATE task_checkin_operations SET state='superseded',updated_at=NEW.updated_at
  WHERE source_id=NEW.source_id AND person_id=NEW.person_id AND state IN ('queued','retryable')
    AND (consent_revision<>NEW.revision OR NEW.state<>'active');
  UPDATE task_checkin_digests SET state='superseded',updated_at=NEW.updated_at
  WHERE source_id=NEW.source_id AND person_id=NEW.person_id AND state IN ('queued','retryable')
    AND (consent_revision<>NEW.revision OR NEW.state<>'active');
END;
CREATE TRIGGER task_checkin_source_supersedes AFTER UPDATE ON task_checkin_sources
BEGIN
  UPDATE task_checkin_operations SET state='superseded',updated_at=NEW.updated_at
  WHERE source_id=NEW.id AND state IN ('queued','retryable')
    AND (policy_revision<>NEW.revision OR NEW.enabled=0);
  UPDATE task_checkin_digests SET state='superseded',updated_at=NEW.updated_at
  WHERE source_id=NEW.id AND state IN ('queued','retryable')
    AND (policy_revision<>NEW.revision OR NEW.enabled=0);
END;
CREATE TRIGGER task_checkin_task_supersedes AFTER UPDATE ON task_checkin_tasks
BEGIN
  UPDATE task_checkin_operations SET state='superseded',updated_at=NEW.updated_at
  WHERE source_id=NEW.source_id AND task_id=NEW.task_id AND state IN ('queued','retryable')
    AND (task_revision<>NEW.revision OR NEW.active=0);
END;
CREATE TRIGGER task_checkin_discord_unlink BEFORE DELETE ON identities
WHEN OLD.platform='discord'
BEGIN
  UPDATE task_checkin_consents SET state='opted_out',revision=revision+1
  WHERE person_id=OLD.person_id AND discord_user_id=OLD.external_id;
END;
CREATE TRIGGER task_checkin_person_erasure AFTER UPDATE OF erased_at ON people
WHEN NEW.erased_at IS NOT NULL
BEGIN
  DELETE FROM task_checkin_operations WHERE person_id=NEW.id;
  DELETE FROM task_checkin_digests WHERE person_id=NEW.id;
  DELETE FROM task_checkin_cards WHERE person_id=NEW.id;
  DELETE FROM task_checkin_consents WHERE person_id=NEW.id;
  DELETE FROM task_checkin_consent_receipts WHERE person_id=NEW.id;
  DELETE FROM task_checkin_mappings WHERE person_id=NEW.id;
END;

CREATE TRIGGER task_checkin_refresh_action_insert AFTER INSERT ON task_checkin_operations
WHEN NEW.kind<>'delivery'
BEGIN
  INSERT INTO task_checkin_card_refreshes(source_id,task_id,person_id,operation_id,next_attempt_at,updated_at)
  SELECT NEW.source_id,NEW.task_id,NEW.person_id,NEW.id,NEW.updated_at,NEW.updated_at
  FROM task_checkin_cards c WHERE c.source_id=NEW.source_id AND c.task_id=NEW.task_id AND c.person_id=NEW.person_id
    AND c.channel_id IS NOT NULL AND c.message_id IS NOT NULL
  ON CONFLICT(source_id,task_id,person_id) DO UPDATE SET
    operation_id=excluded.operation_id,generation=generation+1,state=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN 'processing' ELSE 'queued' END),
    attempts=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN attempts ELSE 0 END),
    claim_token=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN claim_token ELSE NULL END),
    claimed_generation=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN claimed_generation ELSE NULL END),
    lease_expires_at=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN lease_expires_at ELSE NULL END),next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at,reason=NULL
  WHERE task_checkin_card_refreshes.operation_id IS NULL OR
    NEW.created_at>(SELECT created_at FROM task_checkin_operations WHERE id=task_checkin_card_refreshes.operation_id) OR
    (NEW.created_at=(SELECT created_at FROM task_checkin_operations WHERE id=task_checkin_card_refreshes.operation_id)
      AND NEW.id>=task_checkin_card_refreshes.operation_id);
END;

CREATE TRIGGER task_checkin_refresh_action_state AFTER UPDATE OF state ON task_checkin_operations
WHEN NEW.kind<>'delivery' AND NEW.state<>OLD.state
BEGIN
  INSERT INTO task_checkin_card_refreshes(source_id,task_id,person_id,operation_id,next_attempt_at,updated_at)
  SELECT NEW.source_id,NEW.task_id,NEW.person_id,NEW.id,NEW.updated_at,NEW.updated_at
  FROM task_checkin_cards c WHERE c.source_id=NEW.source_id AND c.task_id=NEW.task_id AND c.person_id=NEW.person_id
    AND c.channel_id IS NOT NULL AND c.message_id IS NOT NULL
  ON CONFLICT(source_id,task_id,person_id) DO UPDATE SET
    operation_id=excluded.operation_id,generation=generation+1,state=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN 'processing' ELSE 'queued' END),
    attempts=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN attempts ELSE 0 END),
    claim_token=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN claim_token ELSE NULL END),
    claimed_generation=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN claimed_generation ELSE NULL END),
    lease_expires_at=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN lease_expires_at ELSE NULL END),next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at,reason=NULL
  WHERE task_checkin_card_refreshes.operation_id IS NULL OR
    NEW.created_at>(SELECT created_at FROM task_checkin_operations WHERE id=task_checkin_card_refreshes.operation_id) OR
    (NEW.created_at=(SELECT created_at FROM task_checkin_operations WHERE id=task_checkin_card_refreshes.operation_id)
      AND NEW.id>=task_checkin_card_refreshes.operation_id);
END;

CREATE TRIGGER task_checkin_refresh_source_task AFTER UPDATE ON task_checkin_tasks
WHEN NEW.revision<>OLD.revision OR NEW.active<>OLD.active
BEGIN
  INSERT INTO task_checkin_card_refreshes(source_id,task_id,person_id,operation_id,next_attempt_at,updated_at)
  SELECT c.source_id,c.task_id,c.person_id,
    (SELECT o.id FROM task_checkin_operations o WHERE o.source_id=c.source_id AND o.task_id=c.task_id AND o.person_id=c.person_id
      AND o.kind<>'delivery' ORDER BY o.created_at DESC,o.id DESC LIMIT 1),NEW.updated_at,NEW.updated_at
  FROM task_checkin_cards c WHERE c.source_id=NEW.source_id AND c.task_id=NEW.task_id AND c.channel_id IS NOT NULL AND c.message_id IS NOT NULL
  ON CONFLICT(source_id,task_id,person_id) DO UPDATE SET operation_id=excluded.operation_id,generation=generation+1,state=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN 'processing' ELSE 'queued' END),
    attempts=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN attempts ELSE 0 END),
    claim_token=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN claim_token ELSE NULL END),
    claimed_generation=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN claimed_generation ELSE NULL END),
    lease_expires_at=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN lease_expires_at ELSE NULL END),next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at,reason=NULL;
END;
CREATE TRIGGER task_checkin_refresh_active_consent AFTER UPDATE ON task_checkin_consents
WHEN NEW.state='active'
BEGIN
  INSERT INTO task_checkin_card_refreshes(source_id,task_id,person_id,next_attempt_at,updated_at)
  SELECT source_id,task_id,person_id,NEW.updated_at,NEW.updated_at FROM task_checkin_cards
    WHERE source_id=NEW.source_id AND person_id=NEW.person_id AND channel_id IS NOT NULL AND message_id IS NOT NULL
  ON CONFLICT(source_id,task_id,person_id) DO UPDATE SET operation_id=NULL,generation=generation+1,state=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN 'processing' ELSE 'queued' END),
    attempts=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN attempts ELSE 0 END),
    claim_token=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN claim_token ELSE NULL END),
    claimed_generation=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN claimed_generation ELSE NULL END),
    lease_expires_at=(CASE WHEN task_checkin_card_refreshes.state='processing' THEN lease_expires_at ELSE NULL END),next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at,reason=NULL;
END;

CREATE TABLE task_checkin_recovery (
  operation_id TEXT NOT NULL PRIMARY KEY REFERENCES task_checkin_operations(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  expected_updated_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','checked','failed','superseded')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  claim_token TEXT,
  lease_expires_at TEXT,
  next_attempt_at TEXT NOT NULL,
  reason TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX task_checkin_recovery_queue ON task_checkin_recovery(state,next_attempt_at);

CREATE TABLE task_checkin_notifications (
  kind TEXT NOT NULL CHECK(kind IN ('delivery','digest','escalation')),
  operation_id TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES task_checkin_sources(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  reserved_at TEXT NOT NULL,
  PRIMARY KEY(kind,operation_id)
);
CREATE INDEX task_checkin_notification_window ON task_checkin_notifications(source_id,person_id,reserved_at);
CREATE TRIGGER task_checkin_notification_erasure AFTER UPDATE OF erased_at ON people
WHEN NEW.erased_at IS NOT NULL BEGIN
  DELETE FROM task_checkin_notifications WHERE person_id=NEW.id;
END;

ALTER TABLE task_checkin_cards ADD COLUMN last_escalation_evaluated_at TEXT;
CREATE TABLE task_checkin_escalations (
  id TEXT NOT NULL PRIMARY KEY,
  event_key TEXT NOT NULL,
  recipient_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  subject_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
  recipient_notion_id TEXT,
  task_revision TEXT NOT NULL,
  consent_revision INTEGER NOT NULL,
  recipient_consent_revision INTEGER,
  policy_revision INTEGER NOT NULL,
  trigger_kind TEXT NOT NULL CHECK(trigger_kind IN ('blocker','overdue')),
  blocker_id TEXT REFERENCES task_checkin_operations(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('queued','processing','retryable','confirmed','review','held','failed','superseded','closed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  reason TEXT,
  claim_token TEXT,
  lease_expires_at TEXT,
  next_attempt_at TEXT NOT NULL,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_key,recipient_key),
  FOREIGN KEY(source_id,task_id) REFERENCES task_checkin_tasks(source_id,task_id) ON DELETE CASCADE
);
CREATE INDEX task_checkin_escalation_queue ON task_checkin_escalations(source_id,state,next_attempt_at);
CREATE INDEX task_checkin_escalation_subject ON task_checkin_escalations(subject_id);
CREATE INDEX task_checkin_escalation_recipient ON task_checkin_escalations(person_id);
CREATE TRIGGER task_checkin_escalation_erasure AFTER UPDATE OF erased_at ON people
WHEN NEW.erased_at IS NOT NULL BEGIN
  DELETE FROM task_checkin_escalations WHERE subject_id=NEW.id OR person_id=NEW.id;
END;

CREATE TABLE task_checkin_provider_backoffs (
  source_id TEXT NOT NULL PRIMARY KEY REFERENCES task_checkin_sources(id) ON DELETE CASCADE,
  not_before TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A profile merge or undo changes the owner of a verified Discord identity. It is not a new opt-in.
CREATE TRIGGER task_checkin_identity_reassigned AFTER UPDATE OF person_id ON identities
WHEN OLD.platform='discord' AND OLD.person_id<>NEW.person_id BEGIN
  UPDATE task_checkin_consents SET state=(CASE WHEN state='opted_out' THEN 'opted_out' ELSE 'paused' END),
    revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE person_id IN (OLD.person_id,NEW.person_id);
  DELETE FROM task_checkin_cards WHERE person_id IN (OLD.person_id,NEW.person_id);
  UPDATE task_checkin_escalations SET state='superseded',reason='identity_changed',
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE (subject_id IN (OLD.person_id,NEW.person_id) OR person_id IN (OLD.person_id,NEW.person_id))
      AND state IN ('queued','retryable','review');
END;

CREATE INDEX task_checkin_merge_origins ON merges(surviving_person_id,unmerged_at,erased_at);

-- Human activity outlives private task text under the ordinary person-record policy.
-- Independent opaque references reveal no task, source, provider account or response kind.
CREATE TRIGGER task_checkin_response_activity AFTER INSERT ON task_checkin_operations
WHEN NEW.kind<>'delivery' BEGIN
  INSERT INTO engagement_events(id,person_id,type,occurred_at,source,reference,created_at)
  VALUES(lower(hex(randomblob(16))),NEW.person_id,'task_checkin_response',NEW.created_at,
    'task_checkins',lower(hex(randomblob(16))),NEW.created_at);
END;
CREATE TRIGGER task_checkin_preference_activity AFTER UPDATE OF applied ON task_checkin_consent_receipts
WHEN OLD.applied=0 AND NEW.applied=1 BEGIN
  INSERT INTO engagement_events(id,person_id,type,occurred_at,source,reference,created_at)
  VALUES(lower(hex(randomblob(16))),NEW.person_id,'task_checkin_preference',NEW.created_at,
    'task_checkins',lower(hex(randomblob(16))),NEW.created_at);
END;
