-- Members can ask to join a committee only after an administrator opens it to applications.
-- This is separate from accepting_members, which controls whether staff can assign people at all.
ALTER TABLE committees ADD COLUMN taking_applications INTEGER NOT NULL DEFAULT 0
  CHECK (taking_applications IN (0,1));

-- A member asks to join a committee, either through a posted role or the committee itself.
-- A lead or administrator accepts (which creates an ordinary committee assignment) or declines.
CREATE TABLE committee_applications (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person_keys(id),
  committee_id TEXT REFERENCES committees(id),
  role_slug TEXT CHECK(role_slug IS NULL OR (length(role_slug) BETWEEN 1 AND 100 AND role_slug NOT GLOB '*[^a-z0-9-]*')),
  role_title TEXT CHECK(role_title IS NULL OR length(role_title) BETWEEN 1 AND 200),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=2000),
  -- Space-separated one-hour slots the member is usually free, like 'mon-18 mon-19 sat-9'
  -- (day, then the hour the slot starts, 7 to 21).
  available_hours TEXT NOT NULL DEFAULT '' CHECK(length(available_hours)<=1000),
  -- Hours they could make if needed, in the same form; never also in available_hours.
  if_needed_hours TEXT NOT NULL DEFAULT '' CHECK(length(if_needed_hours)<=1000),
  -- Anything about their schedule the hours above don't cover.
  availability TEXT NOT NULL DEFAULT '' CHECK(length(availability)<=500),
  state TEXT NOT NULL CHECK(state IN ('submitted','accepted','declined','withdrawn')),
  submitted_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES person_keys(id),
  decision_note TEXT NOT NULL DEFAULT '' CHECK(length(decision_note)<=2000),
  assignment_id TEXT,
  updated_at TEXT NOT NULL,
  CHECK(committee_id IS NOT NULL OR role_slug IS NOT NULL),
  CHECK((role_slug IS NULL)=(role_title IS NULL)),
  CHECK((state='submitted')=(decided_at IS NULL)),
  CHECK((state IN ('accepted','declined'))=(decided_by IS NOT NULL)),
  CHECK((state='accepted')=(assignment_id IS NOT NULL))
);
CREATE INDEX committee_applications_person ON committee_applications(person_id,submitted_at);
CREATE INDEX committee_applications_open ON committee_applications(committee_id,submitted_at) WHERE state='submitted';
CREATE TRIGGER committee_applications_person_erasure AFTER UPDATE OF erased_at ON person_keys
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN DELETE FROM committee_applications WHERE person_id=NEW.id; END;
CREATE TRIGGER committee_applications_erased_insert BEFORE INSERT ON committee_applications
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id=NEW.person_id AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'committee applications cannot be saved after erasure'); END;
