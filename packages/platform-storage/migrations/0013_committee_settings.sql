ALTER TABLE committees ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE committees ADD COLUMN time_commitment TEXT NOT NULL DEFAULT '';
ALTER TABLE committees ADD COLUMN accepting_members INTEGER NOT NULL DEFAULT 1 CHECK (accepting_members IN (0,1));
ALTER TABLE committees ADD COLUMN settings_version INTEGER NOT NULL DEFAULT 1 CHECK (settings_version>0);

CREATE UNIQUE INDEX committee_group_unique ON committees(workspace_group_email COLLATE NOCASE) WHERE workspace_group_email IS NOT NULL;
CREATE UNIQUE INDEX committee_discord_role_unique ON committees(discord_role_id) WHERE discord_role_id IS NOT NULL;

-- Keep every managed mapping, including retired mappings, for reconciliation.
-- A later settings change must not make an older access grant impossible to remove.
CREATE TABLE committee_account_mappings (
  committee_id TEXT NOT NULL REFERENCES committees(id),
  provider TEXT NOT NULL CHECK (provider IN ('google_workspace','discord')),
  external_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (committee_id,provider,external_id),
  UNIQUE (provider,external_id)
);
INSERT INTO committee_account_mappings(committee_id,provider,external_id,recorded_at)
SELECT id,'google_workspace',lower(workspace_group_email),updated_at FROM committees WHERE workspace_group_email IS NOT NULL;
INSERT INTO committee_account_mappings(committee_id,provider,external_id,recorded_at)
SELECT id,'discord',discord_role_id,updated_at FROM committees WHERE discord_role_id IS NOT NULL;
CREATE TRIGGER committee_mapping_immutable BEFORE UPDATE ON committee_account_mappings
BEGIN SELECT RAISE(ABORT,'committee account mappings cannot be changed'); END;
CREATE TRIGGER committee_mapping_keep_history BEFORE DELETE ON committee_account_mappings
BEGIN SELECT RAISE(ABORT,'committee account mappings are required for access cleanup'); END;
