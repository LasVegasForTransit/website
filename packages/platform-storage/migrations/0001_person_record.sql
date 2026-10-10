-- Person record, version 1. One row per human LVBT knows about, the evidence
-- of their consent, where each field came from, their accounts elsewhere,
-- what they have done, possible duplicates, merges, and the versioned rules
-- that decide who counts as a member. No table stores a street address:
-- location is a ZIP code and a census block only. See schema.md beside this
-- file for a plain-language description of every column.

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  given_name TEXT,
  family_name TEXT,
  email TEXT,
  email_verified_at TEXT,
  phone TEXT,
  zip TEXT CHECK (zip IS NULL OR (length(zip) = 5 AND zip NOT GLOB '*[^0-9]*')),
  census_block TEXT CHECK (census_block IS NULL OR length(census_block) = 15),
  census_block_vintage TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  membership_status TEXT NOT NULL DEFAULT 'not_member'
    CHECK (membership_status IN ('member', 'former_member', 'not_member')),
  membership_rules_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE UNIQUE INDEX people_email ON people (email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX people_membership_status ON people (membership_status) WHERE deleted_at IS NULL;

CREATE TABLE consent_records (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  scope TEXT NOT NULL CHECK (scope IN ('newsletter', 'event_reminders', 'volunteer_contact')),
  given_at TEXT NOT NULL,
  source TEXT NOT NULL
    CHECK (source IN ('join_form', 'newsletter_box', 'google_form', 'beehiiv', 'paper', 'check_in', 'import')),
  method TEXT NOT NULL CHECK (method IN ('checkbox', 'double_opt_in', 'paper_signature', 'unknown')),
  wording_version TEXT,
  withdrawn_at TEXT,
  withdrawn_source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX consent_records_person ON consent_records (person_id, scope);

CREATE TABLE field_sources (
  person_id TEXT NOT NULL REFERENCES people (id),
  field TEXT NOT NULL,
  source TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (person_id, field)
);

CREATE TABLE identities (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  platform TEXT NOT NULL
    CHECK (platform IN ('beehiiv', 'notion_intake', 'google_workspace', 'discord', 'givebutter', 'luma')),
  external_id TEXT NOT NULL,
  external_email TEXT,
  linked_at TEXT NOT NULL,
  link_method TEXT NOT NULL
    CHECK (link_method IN ('verified_email', 'staff_confirmed', 'self_linked', 'created_by_platform')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX identities_platform_external ON identities (platform, external_id);
CREATE INDEX identities_person ON identities (person_id);

CREATE TABLE engagement_events (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL,
  reference TEXT,
  details TEXT CHECK (details IS NULL OR json_valid(details)),
  created_at TEXT NOT NULL
);

CREATE INDEX engagement_events_person ON engagement_events (person_id, occurred_at);

-- Engagement events are a history: once written they are never changed.
CREATE TRIGGER engagement_events_append_only
BEFORE UPDATE ON engagement_events
BEGIN
  SELECT RAISE(ABORT, 'engagement events cannot be changed');
END;

CREATE TABLE review_queue (
  id TEXT PRIMARY KEY,
  candidate_person_id TEXT NOT NULL REFERENCES people (id),
  existing_person_id TEXT NOT NULL REFERENCES people (id),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution TEXT CHECK (resolution IS NULL OR resolution IN ('merged', 'kept_separate'))
);

CREATE TABLE merges (
  id TEXT PRIMARY KEY,
  surviving_person_id TEXT NOT NULL REFERENCES people (id),
  merged_person_id TEXT NOT NULL REFERENCES people (id),
  merged_at TEXT NOT NULL,
  merged_by TEXT NOT NULL,
  moved_rows TEXT NOT NULL CHECK (json_valid(moved_rows)),
  unmerged_at TEXT,
  unmerged_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE membership_rules (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  rule TEXT NOT NULL CHECK (json_valid(rule)),
  effective_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO membership_rules (version, description, rule, effective_at, created_at, updated_at)
VALUES (
  1,
  'A member is anyone with an active newsletter consent.',
  '{"version":1,"description":"A member is anyone with an active newsletter consent.","member_if":{"active_consent":"newsletter"},"former_member_if":{"withdrawn_consent":"newsletter"}}',
  '2026-09-23T00:00:00.000Z',
  '2026-09-23T00:00:00.000Z',
  '2026-09-23T00:00:00.000Z'
);
