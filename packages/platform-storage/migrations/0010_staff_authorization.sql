CREATE TABLE committees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  workspace_group_email TEXT,
  discord_role_id TEXT,
  interest_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(interest_ids) AND json_type(interest_ids)='array'),
  updated_at TEXT NOT NULL
);
INSERT INTO committees (id,name,updated_at) VALUES
 ('events','Events Committee','2026-10-04T00:00:00Z'),
 ('advocacy','Advocacy Team','2026-10-04T00:00:00Z'),
 ('civic-tech','Civic Tech Team','2026-10-04T00:00:00Z'),
 ('membership','Membership Committee','2026-10-04T00:00:00Z'),
 ('education','Transit and Urbanist Education','2026-10-04T00:00:00Z'),
 ('public-engagement','Public Engagement','2026-10-04T00:00:00Z'),
 ('media','Media Committee','2026-10-04T00:00:00Z'),
 ('unlv','UNLV Student Leadership','2026-10-04T00:00:00Z'),
 ('board','Board of Directors','2026-10-04T00:00:00Z');

CREATE TABLE committee_assignments (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  committee_id TEXT NOT NULL REFERENCES committees(id),
  role TEXT NOT NULL CHECK (role IN ('member','lead')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT CHECK (end_reason IN ('stepped_back','moved','left_lvbt','removed')),
  assigned_by TEXT NOT NULL REFERENCES people(id),
  ended_by TEXT REFERENCES people(id),
  updated_at TEXT NOT NULL,
  CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);
CREATE UNIQUE INDEX committee_one_current ON committee_assignments(person_id,committee_id) WHERE ended_at IS NULL;
CREATE INDEX committee_current_people ON committee_assignments(committee_id,person_id) WHERE ended_at IS NULL;

CREATE TABLE staff_administrators (
  person_id TEXT PRIMARY KEY REFERENCES people(id),
  designated_by TEXT NOT NULL,
  designated_at TEXT NOT NULL
);
CREATE TRIGGER staff_admin_keep_last BEFORE DELETE ON staff_administrators
WHEN EXISTS (SELECT 1 FROM people WHERE id=OLD.person_id AND deleted_at IS NULL)
 AND (SELECT count(*) FROM staff_administrators a JOIN people p ON p.id=a.person_id AND p.deleted_at IS NULL)<=1
BEGIN SELECT RAISE(ABORT,'last_staff_administrator'); END;
CREATE TRIGGER staff_admin_no_delete_last_person BEFORE UPDATE OF deleted_at ON people
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
 AND EXISTS (SELECT 1 FROM staff_administrators WHERE person_id=OLD.id)
 AND (SELECT count(*) FROM staff_administrators a JOIN people p ON p.id=a.person_id AND p.deleted_at IS NULL)<=1
BEGIN SELECT RAISE(ABORT,'last_staff_administrator'); END;

CREATE TABLE staff_operations (
  operation_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  before_state TEXT CHECK (before_state IS NULL OR json_valid(before_state)),
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  created_at TEXT NOT NULL,
  applied_at TEXT
);
CREATE TABLE staff_audits (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  permission TEXT,
  target_id TEXT,
  details TEXT CHECK (details IS NULL OR json_valid(details)),
  operation_id TEXT,
  occurred_at TEXT NOT NULL
);
CREATE UNIQUE INDEX staff_audit_operation ON staff_audits(operation_id,action) WHERE operation_id IS NOT NULL;
CREATE INDEX staff_audit_time ON staff_audits(occurred_at);
CREATE TRIGGER staff_audit_append_only BEFORE UPDATE ON staff_audits
BEGIN SELECT RAISE(ABORT,'staff audits cannot be changed'); END;

CREATE TABLE reconcile_generations (
  person_id TEXT NOT NULL REFERENCES people(id),
  target_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation>0),
  PRIMARY KEY(person_id,target_id)
);
CREATE TABLE integration_outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id),
  target_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','retry','done','superseded')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_failure TEXT,
  next_attempt_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX integration_outbox_due ON integration_outbox(state,next_attempt_at);
