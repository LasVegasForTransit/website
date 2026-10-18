-- Organization labels describe a person independently from committees and access permissions.
CREATE TABLE organization_roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  name_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  retired_at TEXT
);
CREATE TABLE person_organization_roles (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person_keys(id),
  role_id TEXT NOT NULL REFERENCES organization_roles(id),
  assigned_at TEXT NOT NULL,
  assigned_by TEXT NOT NULL REFERENCES person_keys(id),
  ended_at TEXT,
  ended_by TEXT REFERENCES person_keys(id),
  updated_at TEXT NOT NULL,
  CHECK((ended_at IS NULL)=(ended_by IS NULL))
);
CREATE UNIQUE INDEX person_organization_role_current ON person_organization_roles(person_id,role_id)
  WHERE ended_at IS NULL;
CREATE INDEX person_organization_roles_person ON person_organization_roles(person_id,id);
CREATE TRIGGER organization_roles_person_erasure AFTER UPDATE OF erased_at ON person_keys
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN DELETE FROM person_organization_roles WHERE person_id=NEW.id; END;
CREATE TRIGGER organization_roles_erased_insert BEFORE INSERT ON person_organization_roles
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id=NEW.person_id AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'organization roles cannot be assigned after erasure'); END;
CREATE TRIGGER organization_roles_erased_update BEFORE UPDATE ON person_organization_roles
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id=NEW.person_id AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'organization roles cannot be restored after erasure'); END;
