ALTER TABLE committees ADD COLUMN discord_lead_role_id TEXT;
CREATE UNIQUE INDEX committee_discord_lead_unique ON committees(discord_lead_role_id)
  WHERE discord_lead_role_id IS NOT NULL;
ALTER TABLE committee_account_mappings ADD COLUMN role_kind TEXT NOT NULL DEFAULT 'member'
  CHECK(role_kind IN ('member','lead'));
