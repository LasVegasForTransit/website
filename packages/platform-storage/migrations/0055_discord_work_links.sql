-- Shared work placement is independent of private reminder consent.
CREATE TABLE discord_project_homes (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('preview','active','paused','unlinked')),
  generation INTEGER NOT NULL CHECK(generation>0),
  data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX discord_work_project_home ON discord_project_homes(scope_key,source_id,project_id) WHERE state<>'unlinked';
CREATE TABLE discord_work_conversations (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  home_id TEXT NOT NULL REFERENCES discord_project_homes(id),
  subject_key TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('preview','active','paused','unlinked')),
  generation INTEGER NOT NULL CHECK(generation>0),
  data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  next_attempt_at TEXT NOT NULL,
  next_refresh_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX discord_work_subject ON discord_work_conversations(scope_key,subject_key) WHERE state<>'unlinked';
CREATE UNIQUE INDEX discord_work_thread ON discord_work_conversations(scope_key,thread_id) WHERE state<>'unlinked' AND json_extract(data_json,'$.subject.kind')='task' AND json_extract(data_json,'$.mode')='automatic';
CREATE TRIGGER discord_work_exclusive_thread BEFORE INSERT ON discord_work_conversations
WHEN NEW.state<>'unlinked' AND json_extract(NEW.data_json,'$.subject.kind')='task'
 AND EXISTS(SELECT 1 FROM discord_work_conversations other WHERE other.scope_key=NEW.scope_key AND other.thread_id=NEW.thread_id AND other.state<>'unlinked'
   AND json_extract(other.data_json,'$.subject.kind')='task'
   AND (json_extract(NEW.data_json,'$.mode')='automatic' OR json_extract(other.data_json,'$.mode')='automatic'))
BEGIN SELECT RAISE(IGNORE); END;
CREATE INDEX discord_work_due ON discord_work_conversations(scope_key,state,next_attempt_at,id);
CREATE INDEX discord_work_refresh_due ON discord_work_conversations(scope_key,state,next_refresh_at,id);
CREATE TABLE discord_work_operations (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  home_id TEXT REFERENCES discord_project_homes(id),
  conversation_id TEXT REFERENCES discord_work_conversations(id),
  generation INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('provision','backlink','comment','status','refresh')),
  source_key TEXT NOT NULL,
  actor_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  actor_discord_id TEXT NOT NULL,
  grant_version TEXT NOT NULL,
  original_author_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(payload_json)<=32768),
  state TEXT NOT NULL CHECK(state IN ('preview','queued','processing','retryable','held','confirmed','superseded','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT,
  lease_expires_at TEXT,
  expires_at TEXT,
  next_attempt_at TEXT NOT NULL,
  result_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope_key,source_key)
);
CREATE INDEX discord_work_effect_due ON discord_work_operations(scope_key,state,next_attempt_at,id);
CREATE INDEX discord_work_effect_actor ON discord_work_operations(actor_person_id,state);
CREATE INDEX discord_work_history ON discord_work_operations(json_extract(scope_key,'$[2]'),created_at);
CREATE INDEX discord_work_preview_expiry ON discord_work_operations(state,expires_at);
CREATE TRIGGER discord_work_identity_deleted AFTER DELETE ON identities WHEN OLD.platform='discord' BEGIN
  UPDATE discord_work_operations SET payload_json='{}',actor_discord_id='',original_author_id='',grant_version='',
    state=(CASE WHEN state IN ('preview','queued','retryable') THEN 'superseded' ELSE state END),
    reason='identity_removed' WHERE actor_discord_id=OLD.external_id OR original_author_id=OLD.external_id;
END;
CREATE TRIGGER discord_work_person_deleted AFTER UPDATE OF deleted_at ON people WHEN NEW.deleted_at IS NOT NULL BEGIN
  UPDATE discord_work_operations SET state=(CASE WHEN state IN ('processing','held') THEN 'held' ELSE 'superseded' END),payload_json='{}',reason='person_deleted'
    WHERE actor_person_id=NEW.id AND state<>'confirmed';
  UPDATE discord_project_homes SET state='paused',generation=generation+1,
    data_json=json_set(data_json,'$.state','paused','$.generation',generation+1)
    WHERE json_extract(data_json,'$.approvedBy')=NEW.id AND state<>'unlinked';
END;

CREATE TRIGGER discord_work_home_unlinked AFTER UPDATE OF state ON discord_project_homes WHEN NEW.state='unlinked' AND OLD.state<>'unlinked' BEGIN
 UPDATE discord_work_conversations SET state='unlinked',generation=generation+1,data_json=json_set(data_json,'$.state','unlinked','$.generation',generation+1),updated_at=NEW.updated_at WHERE home_id=NEW.id AND scope_key=NEW.scope_key AND state<>'unlinked';
 UPDATE discord_work_operations SET state='superseded',reason=(CASE WHEN state IN ('processing','held') THEN 'unlinked_unconfirmed' ELSE 'unlinked' END),updated_at=NEW.updated_at WHERE scope_key=NEW.scope_key AND (home_id=NEW.id OR json_extract(payload_json,'$.linkId')=NEW.id) AND state IN ('preview','queued','retryable','processing','held');
END;
CREATE UNIQUE INDEX discord_work_provision_reservation ON discord_work_operations(scope_key,json_extract(payload_json,'$.subject.kind'),json_extract(payload_json,'$.subject.sourceId'),json_extract(payload_json,'$.subject.pageId')) WHERE kind='provision' AND state IN ('queued','retryable','processing','held');

CREATE TRIGGER discord_work_exclusive_thread_update BEFORE UPDATE OF data_json,state ON discord_work_conversations
WHEN NEW.state<>'unlinked' AND json_extract(NEW.data_json,'$.subject.kind')='task'
 AND EXISTS(SELECT 1 FROM discord_work_conversations other WHERE other.id<>NEW.id AND other.scope_key=NEW.scope_key AND other.thread_id=NEW.thread_id AND other.state<>'unlinked'
 AND json_extract(other.data_json,'$.subject.kind')='task' AND (json_extract(NEW.data_json,'$.mode')='automatic' OR json_extract(other.data_json,'$.mode')='automatic'))
BEGIN SELECT RAISE(IGNORE); END;
