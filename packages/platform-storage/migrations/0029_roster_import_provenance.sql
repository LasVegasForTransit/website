-- Preserve which provider account established each imported consent and the
-- most recent private run that changed it. The provider identity is the stable key
-- that makes importing the same historical evidence repeat-safe.
ALTER TABLE consent_records
  ADD COLUMN origin_identity_id TEXT REFERENCES identities (id) ON DELETE SET NULL;
ALTER TABLE consent_records ADD COLUMN import_run_id TEXT;

CREATE UNIQUE INDEX consent_import_origin_given
  ON consent_records (origin_identity_id, given_at)
  WHERE origin_identity_id IS NOT NULL;

CREATE TRIGGER consent_import_provenance_insert
BEFORE INSERT ON consent_records
WHEN (NEW.origin_identity_id IS NULL) <> (NEW.import_run_id IS NULL)
  OR (NEW.origin_identity_id IS NOT NULL AND (
    NEW.source <> 'import' OR NEW.import_run_id IS NULL OR length(trim(NEW.import_run_id))=0
    OR NOT EXISTS (
      SELECT 1 FROM identities i WHERE i.id=NEW.origin_identity_id
        AND i.platform IN ('beehiiv','notion_intake')
    )
  ))
BEGIN SELECT RAISE(ABORT,'invalid roster consent provenance'); END;

CREATE TRIGGER consent_import_provenance_update
BEFORE UPDATE OF person_id,source,origin_identity_id,import_run_id ON consent_records
WHEN NEW.origin_identity_id IS NOT NULL AND (
    NEW.source <> 'import' OR NEW.import_run_id IS NULL OR length(trim(NEW.import_run_id))=0
    OR NOT EXISTS (
      SELECT 1 FROM identities i WHERE i.id=NEW.origin_identity_id
        AND i.platform IN ('beehiiv','notion_intake')
    )
  )
BEGIN SELECT RAISE(ABORT,'invalid roster consent provenance'); END;
